// "With relaxations" scenario. Country-agnostic: the country module decides WHICH relaxations
// apply to a plot (area, zone, plan); this file only combines them and recomputes.

import { constant, maxOf, minOf, type Constraint, type Provenance, type Relaxation, type ZoneRuleSet } from "@plotcheck/core";
import type { AnalysisInput, AnalysisResult, CheckStatus, Figures, UnitEstimate } from "./types.ts";

export interface AppliedRelaxation {
  id: string;
  tier: Relaxation["tier"];
  titleKey: string;
  grantKey: string;
  conditionsKey: string;
  instrument: string;
  cost?: Relaxation["cost"];
  statusNoteKey?: string;
  provenance: Provenance;
  /** What it contributed to this plot, in plain numbers. */
  contribution: { farAdd?: number; gfaM2?: number; floorsAdd?: number; heightAddM?: number; verandaM2?: number; basementPerLevelM2?: number; setbackM?: number };
}

export interface RelaxedScenario {
  status: CheckStatus;
  figures: Figures;
  units?: UnitEstimate;
  houses?: AnalysisResult["houses"];
  commercial?: AnalysisResult["commercial"];
  buildableFootprint?: AnalysisResult["buildableFootprint"];
  applied: AppliedRelaxation[];
  /** Density packages that were possible but gave less (shown as alternatives). */
  alternatives: { ids: string[]; farPctTotal: number; farAddTotal: number }[];
  /** Relaxations that apply to this plot but are not in the figures (notes). */
  notes: AppliedRelaxation[];
  /** Full details of the relaxations referenced by `alternatives`. */
  alternativeDetails: AppliedRelaxation[];
  gain: { gfaM2: number; units: number; floors: number };
}

type Analyse = (i: AnalysisInput) => AnalysisResult;

const toApplied = (r: Relaxation, contribution: AppliedRelaxation["contribution"] = {}): AppliedRelaxation => ({
  id: r.id,
  tier: r.tier,
  titleKey: r.titleKey,
  grantKey: r.grantKey,
  conditionsKey: r.conditionsKey,
  instrument: r.instrument,
  ...(r.cost ? { cost: r.cost } : {}),
  ...(r.statusNoteKey ? { statusNoteKey: r.statusNoteKey } : {}),
  provenance: r.provenance,
  contribution,
});

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function eligible(r: Relaxation, input: AnalysisInput, plotArea: number): boolean {
  if (r.uses && !r.uses.includes(input.use)) return false;
  if (r.minPlotAreaM2 !== undefined && plotArea < r.minPlotAreaM2) return false;
  if (r.maxPlotAreaM2 !== undefined && plotArea > r.maxPlotAreaM2) return false;
  return true;
}

/** Best combination of density relaxations: max uplift, ≤1 per exclusive group, caps respected. */
export function bestDensityPackage(cands: Relaxation[], baseFar: number) {
  const n = Math.min(cands.length, 14);
  let best: { set: Relaxation[]; add: number } = { set: [], add: 0 };
  const all: { set: Relaxation[]; add: number }[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const set = cands.filter((_, i) => mask & (1 << i));
    const groups = set.map((r) => r.exclusiveGroup).filter(Boolean);
    if (new Set(groups).size !== groups.length) continue;
    const clash = (a: Relaxation, b: Relaxation) =>
      (a.notCombinableWith ?? []).some((x) => (x.endsWith("*") ? b.id.startsWith(x.slice(0, -1)) : b.id === x));
    if (set.some((a) => set.some((b) => a !== b && (clash(a, b) || clash(b, a))))) continue;
    const capSum = new Map<string, { sum: number; max: number }>();
    let ok = true;
    for (const r of set) {
      if (!r.cap) continue;
      const c = capSum.get(r.cap.group) ?? { sum: 0, max: r.cap.maxPct };
      c.sum += r.effect.farPct ?? 0;
      c.max = Math.min(c.max, r.cap.maxPct);
      capSum.set(r.cap.group, c);
      if (c.sum > c.max + 1e-9) ok = false;
    }
    if (!ok) continue;
    let far = baseFar + set.reduce((s, r) => s + (r.effect.farPct ?? 0) * baseFar + (r.effect.farAdd ?? 0), 0);
    const ceiling = Math.min(...set.map((r) => r.effect.maxFar ?? Infinity));
    far = Math.min(far, ceiling);
    const add = far - baseFar;
    all.push({ set, add });
    // prefer larger uplift; on ties prefer fewer obligations
    const costs = (s: Relaxation[]) => s.filter((r) => r.cost && r.cost.type !== "none").length;
    if (add > best.add + 1e-9 || (Math.abs(add - best.add) < 1e-9 && costs(set) < costs(best.set))) best = { set, add };
  }
  // alternatives: best package per distinct exclusive-group choice, excluding the chosen one
  const key = (s: Relaxation[]) => s.map((r) => r.id).sort().join("+");
  const alternatives = all
    .filter((p) => p.add > 0 && key(p.set) !== key(best.set))
    .sort((a, b) => b.add - a.add)
    .filter((p, i, arr) => arr.findIndex((q) => q.set.map((r) => r.exclusiveGroup ?? r.id).sort().join() === p.set.map((r) => r.exclusiveGroup ?? r.id).sort().join()) === i)
    .slice(0, 3);
  return { best, alternatives };
}

function withMax(rules: ZoneRuleSet, name: "far" | "stories" | "height" | "lot_cov_bldg", value: number, prov: Provenance): void {
  rules.constraints[name] = constant("max", value, prov, "Relaxed value") as Constraint;
}

export function applyRelaxations(input: AnalysisInput, base: AnalysisResult, relaxations: Relaxation[], analyse: Analyse): RelaxedScenario | undefined {
  const plotArea = base.figures.plotAreaM2;
  const list = relaxations.filter((r) => eligible(r, input, plotArea));
  if (list.length === 0) return undefined;
  const rules: ZoneRuleSet = structuredClone(input.rules);
  const relaxProv: Provenance = { source: "Relaxation scenario", status: "needs_review" };
  const applied: AppliedRelaxation[] = [];
  const usedIds = new Set<string>();

  const baseFar = maxOf(input.rules, "far")?.value ?? 0;
  const baseStories = maxOf(input.rules, "stories")?.value;
  const baseHeight = maxOf(input.rules, "height")?.value;
  const baseCov = maxOf(input.rules, "lot_cov_bldg")?.value;
  const st = input.params.storeyHeightM;

  // 1. Density package
  const densityCands = list.filter((r) => r.quantified && (r.effect.farPct || r.effect.farAdd));
  const { best, alternatives } = bestDensityPackage(densityCands, baseFar);
  const far = baseFar + best.add;
  let floorsAdd = 0;
  let coverage = baseCov;
  let floorsTo = 0; // scheme grants floors "up to N"
  for (const r of best.set) {
    const add = (r.effect.farPct ?? 0) * baseFar + (r.effect.farAdd ?? 0);
    const schemeFloors = r.effect.floorsAdd ?? (r.effect.maxFloors !== undefined && baseStories !== undefined ? Math.max(0, r.effect.maxFloors - baseStories) : undefined);
    applied.push(toApplied(r, { farAdd: round(add, 3), gfaM2: round(add * plotArea, 0), ...(schemeFloors ? { floorsAdd: schemeFloors, heightAddM: round(schemeFloors * st, 1) } : {}) }));
    usedIds.add(r.id);
    if (r.effect.floorsAdd) floorsAdd = Math.max(floorsAdd, r.effect.floorsAdd);
    if (r.effect.coverageMax !== undefined && coverage !== undefined) coverage = Math.min(coverage, r.effect.coverageMax);
    if (r.effect.maxFloors !== undefined) floorsTo = Math.max(floorsTo, r.effect.maxFloors);
  }
  if (far !== baseFar) withMax(rules, "far", far, relaxProv);
  for (const r of best.set) {
    if (r.effect.setbackRule) rules.constraints.setback_dist_boundary = { min_val: r.effect.setbackRule, provenance: r.provenance } as Constraint;
  }
  if (coverage !== undefined && coverage !== baseCov) withMax(rules, "lot_cov_bldg", coverage, relaxProv);

  // 2. Setbacks (e.g. continuous building)
  const sbRelax = list.filter((r) => r.quantified && r.effect.setbackM !== undefined).sort((a, b) => a.effect.setbackM! - b.effect.setbackM!)[0];
  const baseSetback = base.figures.setbackM;
  if (sbRelax && baseSetback !== undefined && sbRelax.effect.setbackM! < baseSetback) {
    rules.constraints.setback_dist_boundary = constant("min", sbRelax.effect.setbackM!, relaxProv) as Constraint;
    applied.push(toApplied(sbRelax, { setbackM: sbRelax.effect.setbackM }));
    usedIds.add(sbRelax.id);
  }

  // 3. Height per floor (offices/commercial)
  const hpf = list.find((r) => r.quantified && r.effect.heightPerFloorM);
  let heightPerFloorAdd = 0;
  if (hpf) {
    heightPerFloorAdd = hpf.effect.heightPerFloorM!;
    usedIds.add(hpf.id);
  }

  // 4. Floors: scheme floors first; then discretionary extra floors only if needed to build the density
  const recompute = () => {
    const stories = baseStories !== undefined ? Math.max(baseStories + floorsAdd, floorsTo) : floorsTo || undefined;
    if (stories !== undefined) withMax(rules, "stories", stories, relaxProv);
    const extraFloors = stories !== undefined && baseStories !== undefined ? stories - baseStories : floorsAdd;
    if (baseHeight !== undefined) withMax(rules, "height", baseHeight + extraFloors * st + heightPerFloorAdd * (stories ?? 0), relaxProv);
    return analyse({ ...input, rules, relaxations: undefined });
  };
  let res = recompute();
  const discretionaryFloors = list.find((r) => r.quantified && r.tier === "discretionary" && r.effect.floorsAdd);
  if (discretionaryFloors && res.figures.achievableGfaM2 < res.figures.maxGfaM2 - 0.5 && floorsTo === 0) {
    // add floors one at a time, only while they are needed to build the extra density
    let extra = 0;
    while (extra < discretionaryFloors.effect.floorsAdd! && res.figures.achievableGfaM2 < res.figures.maxGfaM2 - 0.5) {
      const before = res.figures.achievableGfaM2;
      extra++;
      floorsAdd++;
      res = recompute();
      if (res.figures.achievableGfaM2 <= before + 0.5) {
        floorsAdd--;
        extra--;
        res = recompute();
        break;
      }
    }
    if (extra > 0) {
      applied.push(toApplied(discretionaryFloors, { floorsAdd: extra, heightAddM: round(extra * st, 1) }));
      usedIds.add(discretionaryFloors.id);
    }
  }
  if (hpf) {
    applied.push(toApplied(hpf, { heightAddM: round(heightPerFloorAdd * res.figures.feasibleFloors, 1) }));
  }

  // 5. Areas not counted in density
  for (const r of list.filter((x) => x.quantified && (x.effect.excludedVerandaPct || x.effect.basementExcluded))) {
    if (r.effect.excludedVerandaPct) applied.push(toApplied(r, { verandaM2: round(res.figures.achievableGfaM2 * r.effect.excludedVerandaPct, 0) }));
    if (r.effect.basementExcluded) applied.push(toApplied(r, { basementPerLevelM2: round(res.figures.netFootprintM2 ?? res.figures.footprintM2, 0) }));
    usedIds.add(r.id);
  }

  const altIds = new Set(alternatives.flatMap((p) => p.set.map((r) => r.id)));
  const notes = list.filter((r) => !usedIds.has(r.id) && !altIds.has(r.id)).map((r) => toApplied(r));
  const altDetails = list.filter((r) => altIds.has(r.id) && !usedIds.has(r.id)).map((r) => toApplied(r));
  const anySoft = applied.some((a) => a.tier !== "entitlement");
  const status: CheckStatus = res.status === "not_allowed" ? "not_allowed" : anySoft || res.status === "maybe" ? "maybe" : "allowed";

  return {
    status,
    figures: res.figures,
    ...(res.units ? { units: res.units } : {}),
    ...(res.houses ? { houses: res.houses } : {}),
    ...(res.commercial ? { commercial: res.commercial } : {}),
    ...(res.buildableFootprint ? { buildableFootprint: res.buildableFootprint } : {}),
    applied,
    alternatives: alternatives.map((p) => ({
      ids: p.set.map((r) => r.id),
      farPctTotal: round(p.set.reduce((s, r) => s + (r.effect.farPct ?? 0), 0), 3),
      farAddTotal: round(p.add, 3),
    })),
    notes,
    alternativeDetails: altDetails,
    gain: {
      gfaM2: round(res.figures.achievableGfaM2 - base.figures.achievableGfaM2, 1),
      units: (res.units?.total ?? res.houses?.count ?? 0) - (base.units?.total ?? base.houses?.count ?? 0),
      floors: res.figures.feasibleFloors - base.figures.feasibleFloors,
    },
  };
}

export { minOf };
