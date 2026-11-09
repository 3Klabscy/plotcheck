// "What can I build and what is it worth?" — every allowed building type side by side:
// what gets built, sellable area, sales value, construction cost and the land price it can carry.
import { areasFrom, finance, type AnalysisResult, type FinanceAreas, type FinanceResult } from "@plotcheck/engine";
import type { UseType } from "@plotcheck/core";
import type { AnalyseResponse, FinanceDefaults } from "./api";

export interface PriceChoice {
  perM2: number;
  /** "comparables": average of comparable sales; "estimate": the country module's default. */
  source: "comparables" | "estimate";
  count?: number;
}

export interface OptionRow {
  use: UseType;
  result: AnalysisResult;
  relaxed: boolean;
  gfaM2: number;
  floors: number;
  units?: number;
  houses?: number;
  areas: FinanceAreas;
  price: PriceChoice;
  obligations: Obligations;
  finance: FinanceResult;
}

/** The scenario figures (relaxed when asked and available) and verandas gained by relaxations. */
export function scenarioOf(result: AnalysisResult, relaxed: boolean) {
  const x = relaxed && result.relaxed && result.relaxed.gain.gfaM2 > 0.5 ? result.relaxed : undefined;
  return {
    src: x ?? result,
    relaxed: !!x,
    verandaM2: x ? x.applied.reduce((s, a) => s + (a.contribution.verandaM2 ?? 0), 0) : 0,
  };
}

export interface Obligations {
  /** Buildable m² sold at the scheme's fixed price, and that price. */
  affordableBuildableM2?: number;
  affordablePricePerM2Buildable?: number;
  /** Buy-out payment, when the scheme's buy-out is the way used. */
  schemeCompensation?: number;
  /** The buy-out could not be priced (no official value of building density for the plot). */
  compensationUnpriced?: boolean;
}

/** What the relaxations used in a scenario oblige the developer to do, priced for the finance model. */
export function obligationsFor(result: AnalysisResult, relaxed: boolean, fd: FinanceDefaults | undefined): Obligations {
  const { relaxed: on } = scenarioOf(result, relaxed);
  if (!on || !result.relaxed) return {};
  const out: Obligations = {};
  for (const a of result.relaxed.applied) {
    const c = a.cost;
    if (!c) continue;
    if (c.affordableShareOfPermitted && c.fixedPricePerM2Buildable) {
      out.affordableBuildableM2 = Math.round(c.affordableShareOfPermitted * result.figures.maxGfaM2);
      out.affordablePricePerM2Buildable = c.fixedPricePerM2Buildable;
    }
    if (c.compensationFactor) {
      const v = fd?.officialLandValue?.perM2Buildable;
      if (v) out.schemeCompensation = Math.round((a.contribution.gfaM2 ?? 0) * c.compensationFactor * v);
      else out.compensationUnpriced = true;
    }
  }
  return out;
}

export function compareOptions(data: AnalyseResponse, opts: { relaxed: boolean; priceFor(use: UseType): PriceChoice | undefined }): OptionRow[] {
  const fd = data.finance;
  if (!fd) return [];
  return data.results
    .filter((r) => r.status !== "not_allowed" && r.figures.achievableGfaM2 > 0)
    .map((r) => {
      const { src, relaxed, verandaM2 } = scenarioOf(r, opts.relaxed);
      const defaults = fd.byUse[r.use];
      const chosen = opts.priceFor(r.use);
      const price: PriceChoice = chosen ?? { perM2: r.use === "commercial" ? defaults.commercialPricePerM2 : defaults.salePricePerM2, source: "estimate" };
      const ob = obligationsFor(r, opts.relaxed, fd);
      const base = r.use === "commercial" ? { ...defaults, commercialPricePerM2: price.perM2 } : { ...defaults, salePricePerM2: price.perM2 };
      const params = { ...base, ...(ob.affordableBuildableM2 ? { affordableBuildableM2: ob.affordableBuildableM2, affordablePricePerM2Buildable: ob.affordablePricePerM2Buildable! } : {}), ...(ob.schemeCompensation ? { schemeCompensation: ob.schemeCompensation } : {}) };
      const areas = areasFrom(src, data.params.netToGross, verandaM2);
      return {
        use: r.use,
        result: r,
        relaxed,
        gfaM2: src.figures.achievableGfaM2,
        floors: src.figures.feasibleFloors,
        ...(src.units ? { units: src.units.total } : {}),
        ...(r.use === "row_houses" && src.houses ? { houses: src.houses.count } : r.use === "house" ? { houses: 1 } : {}),
        areas,
        price,
        obligations: ob,
        finance: finance(areas, params),
      };
    })
    .sort((a, b) => b.finance.residualLandValue - a.finance.residualLandValue);
}
