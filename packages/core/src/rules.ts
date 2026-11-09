import { evaluate, ExprError, type Vars } from "./expr.ts";
import type { Constraint, ConstraintName, ConstraintValue, Jurisdiction, RuleLayer, ZoneRuleSet } from "./types.ts";

/** Lower index = lower precedence. A curated zone record beats published source data. */
const LEVEL_ORDER: RuleLayer["level"][] = ["country", "region", "municipality", "plan", "source", "zone"];

function layerMatches(layer: RuleLayer, path: string[], distAbbr: string, planRef?: string): boolean {
  const m = layer.match;
  if (m.plan && m.plan !== planRef) return false;
  if (m.path && !m.path.every((seg, i) => path[i] === seg)) return false;
  if (m.dist_abbr && m.dist_abbr !== distAbbr) return false;
  if (m.dist_prefix && !distAbbr.startsWith(m.dist_prefix)) return false;
  return true;
}

/**
 * Merge rule layers along the jurisdiction hierarchy (country → region → municipality →
 * plan → published source → curated zone). Later layers override earlier ones per
 * constraint, so a zone can override just its setbacks and inherit everything else.
 */
export function resolveRules(jurisdiction: Jurisdiction, distAbbr: string, layers: RuleLayer[], planRef?: string): ZoneRuleSet {
  const applicable = layers
    .filter((l) => layerMatches(l, jurisdiction.path, distAbbr, planRef))
    .sort((a, b) => {
      const d = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
      // within a level, the more specific match (longer path) wins
      return d !== 0 ? d : (a.match.path?.length ?? 0) - (b.match.path?.length ?? 0);
    });

  const out: ZoneRuleSet = {
    schema: "ozfs-eu/0.1",
    jurisdiction,
    dist_abbr: distAbbr,
    uses_allowed: { value: null, provenance: { source: "none", status: "needs_review" } },
    constraints: {},
    bonuses: [],
    provisions: [],
    curated: false,
    updatedAt: new Date(0).toISOString(),
  };
  for (const l of applicable) {
    if (l.dist_name) out.dist_name = l.dist_name;
    if (l.plan) out.plan = l.plan;
    if (l.uses_allowed) {
      out.uses_allowed = l.uses_allowed;
      out.uses_conditional = l.uses_conditional ?? [];
    }
    if (l.constraints) out.constraints = { ...out.constraints, ...l.constraints };
    if (l.bonuses) out.bonuses = [...out.bonuses, ...l.bonuses];
    if (l.provisions) out.provisions = [...out.provisions, ...l.provisions];
    if (l.dwellings) out.dwellings = l.dwellings;
    if (l.level === "zone" && l.curated !== false) out.curated = true;
    if (l.updatedAt && l.updatedAt > out.updatedAt) out.updatedAt = l.updatedAt;
  }
  return out;
}

export interface ResolvedBound {
  /** Candidate values. One value = unambiguous; several = conditions could not be decided. */
  values: number[];
  ambiguous: boolean;
  reasons: string[];
}

function evalList(v: ConstraintValue, vars: Vars, reasons: string[]): { vals: number[]; ambiguous: boolean } {
  const exprs = Array.isArray(v.expression) ? v.expression : [v.expression];
  const vals: number[] = [];
  let ambiguous = false;
  for (const e of exprs) {
    try {
      vals.push(Number(evaluate(e, vars)));
    } catch (err) {
      ambiguous = true;
      reasons.push(`Could not evaluate "${e}": ${(err as Error).message}`);
    }
  }
  if (vals.length > 1 && v.min_max) return { vals: [v.min_max === "min" ? Math.min(...vals) : Math.max(...vals)], ambiguous };
  return { vals, ambiguous: ambiguous || vals.length > 1 };
}

/** Port of zoneR's min/max resolution: first matching condition wins; undecidable → candidates. */
export function resolveBound(entries: ConstraintValue[] | undefined, vars: Vars): ResolvedBound | undefined {
  if (!entries || entries.length === 0) return undefined;
  const reasons: string[] = [];
  const candidates: number[] = [];
  let ambiguous = false;
  for (const entry of entries) {
    let applies: boolean | "unknown";
    if (entry.condition === undefined || entry.condition === true || entry.condition === "True") applies = true;
    else if (entry.condition === false) applies = false;
    else {
      try {
        applies = Boolean(evaluate(entry.condition, vars));
      } catch (err) {
        applies = "unknown";
        reasons.push(
          err instanceof ExprError ? `Condition not machine-checkable: "${entry.condition}"` : String(err),
        );
      }
    }
    if (applies === false) continue;
    const { vals, ambiguous: a } = evalList(entry, vars, reasons);
    candidates.push(...vals);
    if (a) ambiguous = true;
    if (applies === true) break; // first definite match wins
    ambiguous = true; // unknown condition: keep collecting candidates from later entries
  }
  if (candidates.length === 0) return undefined;
  const uniq = [...new Set(candidates)];
  return { values: uniq, ambiguous: ambiguous && uniq.length > 1, reasons };
}

export interface ResolvedConstraint {
  name: ConstraintName;
  min?: ResolvedBound;
  max?: ResolvedBound;
  constraint: Constraint;
}

export function resolveConstraint(rules: ZoneRuleSet, name: ConstraintName, vars: Vars): ResolvedConstraint | undefined {
  const c = rules.constraints[name];
  if (!c) return undefined;
  return { name, constraint: c, min: resolveBound(c.min_val, vars), max: resolveBound(c.max_val, vars) };
}

/** Most restrictive upper bound (used for planning capacity), plus whether it was ambiguous. */
export function maxOf(rules: ZoneRuleSet, name: ConstraintName, vars: Vars = {}): { value: number; ambiguous: boolean; constraint: Constraint } | undefined {
  const r = resolveConstraint(rules, name, vars);
  if (!r?.max) return undefined;
  return { value: Math.min(...r.max.values), ambiguous: r.max.ambiguous, constraint: r.constraint };
}

/** Most demanding lower bound (e.g. the largest required setback). */
export function minOf(rules: ZoneRuleSet, name: ConstraintName, vars: Vars = {}): { value: number; ambiguous: boolean; constraint: Constraint } | undefined {
  const r = resolveConstraint(rules, name, vars);
  if (!r?.min) return undefined;
  return { value: Math.max(...r.min.values), ambiguous: r.min.ambiguous, constraint: r.constraint };
}

/** Helper for rule authors: a constant bound with provenance. */
export function constant(kind: "min" | "max", value: number, provenance: Constraint["provenance"], notes?: string): Constraint {
  return { [kind === "min" ? "min_val" : "max_val"]: [{ expression: value }], provenance, ...(notes ? { notes } : {}) } as Constraint;
}
