// "What can I build and what is it worth?" — every allowed building type side by side:
// what gets built, sellable area, sales value, construction cost and the land price it can carry.
import { areasFrom, finance, type AnalysisResult, type FinanceAreas, type FinanceResult } from "@plotcheck/engine";
import type { UseType } from "@plotcheck/core";
import type { AnalyseResponse } from "./api";

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
      const params = r.use === "commercial" ? { ...defaults, commercialPricePerM2: price.perM2 } : { ...defaults, salePricePerM2: price.perM2 };
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
        finance: finance(areas, params),
      };
    })
    .sort((a, b) => b.finance.residualLandValue - a.finance.residualLandValue);
}
