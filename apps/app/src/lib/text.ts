// Plain-text renderings shared by the result screen and the PDF report (no React Native here).
import type { TFunction } from "i18next";
import type { AnalysisResult, AppliedRelaxation, Check } from "@plotcheck/engine";
import { fmtArea, fmtNumber } from "./format";

/** Translate engine reason params: use keys → names, numbers → local format. */
export function reasonText(t: TFunction, lng: string, c: Pick<Check, "reasonKey" | "params">): string {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.params ?? {})) {
    if (k === "use") params[k] = t(`use.${v}`);
    else if (k === "type") params[k] = t(`unit.${v}`);
    else if (k === "surface") params[k] = t(`surface.${v}`);
    else if (k === "years" || k === "code") params[k] = String(v);
    else params[k] = typeof v === "number" ? fmtNumber(v, lng, 1) : String(v);
  }
  return t(c.reasonKey, params);
}

export function headline(t: TFunction, lng: string, r: AnalysisResult): string {
  const f = r.figures;
  if (r.checks.some((c) => c.id === "use" && c.status === "not_allowed")) {
    return t("result.headline.not_allowed", { use: t(`use.${r.use}`), zone: r.zone.code });
  }
  const base = { gfa: fmtArea(f.achievableGfaM2, lng), floors: f.feasibleFloors, coverage: fmtArea(f.footprintM2, lng) };
  let s = "";
  switch (r.use) {
    case "apartment_block":
      s = t("result.headline.apartment_block", { ...base, units: r.units?.total ?? 0, pmin: r.units?.parking.min ?? 0, pmax: r.units?.parking.max ?? 0 });
      break;
    case "house":
      s = t("result.headline.house", base);
      break;
    case "row_houses":
      s = t("result.headline.row_houses", { ...base, count: r.houses?.count ?? 0, each: fmtArea(r.houses?.gfaEachM2 ?? 0, lng) });
      break;
    case "commercial":
      s = t("result.headline.commercial", { ...base, net: fmtArea(r.commercial?.netM2 ?? 0, lng), pmin: r.commercial?.parking.min ?? 0, pmax: r.commercial?.parking.max ?? 0 });
      break;
    case "mixed_use":
      s = t("result.headline.mixed_use", { ...base, commercial: fmtArea(r.commercial?.gfaM2 ?? 0, lng), units: r.units?.total ?? 0 });
      break;
  }
  return r.status === "maybe" ? t("result.headline.maybePrefix") + s : s;
}


export function contributionText(t: TFunction, lng: string, a: AppliedRelaxation): string[] {
  const c = a.contribution;
  const out: string[] = [];
  if (c.farAdd) out.push(t("contrib.far", { far: fmtNumber(c.farAdd, lng, 2), gfa: fmtArea(c.gfaM2 ?? 0, lng) }));
  if (c.floorsAdd) out.push(t("contrib.floors", { floors: c.floorsAdd, height: fmtNumber(c.heightAddM ?? 0, lng, 1) }));
  else if (c.heightAddM) out.push(t("contrib.height", { height: fmtNumber(c.heightAddM, lng, 1) }));
  if (c.verandaM2) out.push(t("contrib.veranda", { area: fmtArea(c.verandaM2, lng) }));
  if (c.basementPerLevelM2) out.push(t("contrib.basement", { area: fmtArea(c.basementPerLevelM2, lng) }));
  if (c.setbackM !== undefined) out.push(t("contrib.setback", { m: fmtNumber(c.setbackM, lng, 1) }));
  return out;
}


export function relaxedHeadline(t: TFunction, lng: string, result: AnalysisResult): string | undefined {
  const x = result.relaxed;
  if (!x) return undefined;
  const f = x.figures;
  return x.gain.gfaM2 <= 0.5
    ? t("relax.headline.none")
    : x.units
      ? t("relax.headline.units", { gfa: fmtArea(f.achievableGfaM2, lng), floors: f.feasibleFloors, units: x.units.total, gain: fmtArea(x.gain.gfaM2, lng), gainUnits: x.gain.units })
      : t("relax.headline.area", { gfa: fmtArea(f.achievableGfaM2, lng), floors: f.feasibleFloors, gain: fmtArea(x.gain.gfaM2, lng) });
}

/** Group unverified values by their source so each source is listed once. */
export function dedupeReview(r: AnalysisResult) {
  const groups = new Map<string, Set<string>>();
  for (const w of r.needsReview) {
    const g = groups.get(w.provenance.source) ?? new Set<string>();
    g.add(w.constraint);
    groups.set(w.provenance.source, g);
  }
  return [...groups].map(([source, cs]) => ({ source, constraints: [...cs] }));
}

/** One line naming every relaxation used in the figures, with its share of the density uplift. */
export function usedSummary(t: TFunction, lng: string, result: AnalysisResult): string | undefined {
  const x = result.relaxed;
  if (!x || x.applied.length === 0) return undefined;
  const baseFar = result.figures.far;
  let totalPct = 0;
  const parts = x.applied.map((a) => {
    const add = a.contribution.farAdd ?? 0;
    if (add > 0 && baseFar > 0) {
      const pct = Math.round((add / baseFar) * 100);
      totalPct += pct;
      return `${t(a.titleKey)} (+${pct}%)`;
    }
    return t(a.titleKey);
  });
  return totalPct > 0
    ? t("relax.usedTotal", { list: parts.join(", "), pct: fmtNumber(totalPct, lng) })
    : t("relax.used", { list: parts.join(", ") });
}
