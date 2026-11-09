// Financial feasibility. Pure and country-agnostic: country modules supply the defaults
// (prices, costs, fee bands); the client adjusts them with sliders and recomputes instantly.

import type { AnalysisResult, Figures, UnitEstimate } from "./types.ts";

export interface FeeBand {
  /** Upper bound of the band (inclusive); null = no limit. */
  upTo: number | null;
  rate: number;
}

export interface FinanceParams {
  currency: string;
  /** Sale price per m² of sellable (net) residential area. */
  salePricePerM2: number;
  /** Sale price per m² of net commercial area. */
  commercialPricePerM2: number;
  /** Covered verandas are sold at this share of the price per m². */
  verandaValueShare: number;
  /** Construction cost per m² of gross floor area, by finish level chosen. */
  constructionCostPerM2: number;
  /** Covered verandas cost this share of the main construction rate. */
  verandaCostShare: number;
  /** Basement levels to build (parking/storage) and their cost per m². */
  basementLevels: number;
  basementCostPerM2: number;
  /** Site/external works as a share of construction. */
  externalWorksPct: number;
  designPct: number; // architects/engineers, of hard cost
  permitsPct: number; // planning/building permit fees, of hard cost
  legalPct: number; // of hard cost
  contingencyPct: number; // of hard cost
  marketingPctOfGdv: number; // agents/marketing, of sales value
  financePct: number; // interest and loan fees, of total cost (simplified)
  /** Developer profit required, as a share of sales value (for the residual land value). */
  targetProfitPctOfGdv: number;
  /** Fees the buyer of the land pays on its price (e.g. transfer fees), by band. */
  landPurchaseFeeBands: FeeBand[];
  /** Optional known land price: then profit is computed on it. */
  landPrice?: number;
  /** Long-term rent per m² of sellable area per month (for hold-and-rent investors). */
  rentPerM2Month: number;
  /** Operating costs and voids as a share of gross rent. */
  rentCostsPct: number;
}

export interface FinanceResult {
  currency: string;
  gdv: number;
  gdvBreakdown: { residential: number; commercial: number; verandas: number };
  hardCost: number;
  hardBreakdown: { building: number; verandas: number; basement: number; external: number };
  softCost: number;
  softBreakdown: { design: number; permits: number; legal: number; contingency: number; marketing: number; finance: number };
  /** Total development cost excluding land. */
  devCost: number;
  /** Sales value minus development cost: what is left to pay for land and profit. */
  surplusBeforeLand: number;
  /** Maximum land price (excluding fees) that still leaves the target profit. */
  residualLandValue: number;
  residualLandFees: number;
  /** With a known land price. */
  withLand?: { landPrice: number; landFees: number; totalCost: number; profit: number; marginOnGdv: number; marginOnCost: number };
  rental: { grossAnnual: number; netAnnual: number; grossYield: number; netYield: number; onCost: number };
}

const r0 = (n: number) => Math.round(n);

export function feesOn(price: number, bands: FeeBand[]): number {
  let fee = 0, prev = 0;
  for (const b of bands) {
    const top = b.upTo ?? Infinity;
    if (price > prev) fee += (Math.min(price, top) - prev) * b.rate;
    prev = top;
    if (price <= top) break;
  }
  return fee;
}

/** Areas from an analysis result (base or relaxed scenario). */
export interface FinanceAreas {
  gfaM2: number;
  footprintM2: number;
  residentialNetM2: number;
  commercialNetM2: number;
  verandaM2: number;
}

export function areasFrom(r: { figures: Figures; units?: UnitEstimate; houses?: AnalysisResult["houses"]; commercial?: AnalysisResult["commercial"] }, netToGross: number, verandaM2 = 0): FinanceAreas {
  const commercialNet = r.commercial?.netM2 ?? 0;
  const residentialNet = r.units ? r.units.sellableM2 : r.houses ? Math.round(r.figures.achievableGfaM2 * netToGross) : 0;
  return { gfaM2: r.figures.achievableGfaM2, footprintM2: r.figures.footprintM2, residentialNetM2: residentialNet, commercialNetM2: commercialNet, verandaM2 };
}

export function finance(a: FinanceAreas, p: FinanceParams): FinanceResult {
  const residential = a.residentialNetM2 * p.salePricePerM2;
  const commercial = a.commercialNetM2 * p.commercialPricePerM2;
  const verandas = a.verandaM2 * p.salePricePerM2 * p.verandaValueShare;
  const gdv = residential + commercial + verandas;

  const building = a.gfaM2 * p.constructionCostPerM2;
  const verandaCost = a.verandaM2 * p.constructionCostPerM2 * p.verandaCostShare;
  const basement = p.basementLevels * a.footprintM2 * p.basementCostPerM2;
  const external = (building + verandaCost + basement) * p.externalWorksPct;
  const hardCost = building + verandaCost + basement + external;

  const design = hardCost * p.designPct;
  const permits = hardCost * p.permitsPct;
  const legal = hardCost * p.legalPct;
  const contingency = hardCost * p.contingencyPct;
  const marketing = gdv * p.marketingPctOfGdv;
  const beforeFinance = hardCost + design + permits + legal + contingency + marketing;
  const financeCost = beforeFinance * p.financePct;
  const softCost = design + permits + legal + contingency + marketing + financeCost;
  const devCost = hardCost + softCost;
  const surplus = gdv - devCost;

  // Residual land value L: L + fees(L) = surplus − target profit (solve by bisection)
  const budget = surplus - gdv * p.targetProfitPctOfGdv;
  let lo = 0, hi = Math.max(0, budget);
  for (let i = 0; i < 60 && hi > 0; i++) {
    const mid = (lo + hi) / 2;
    if (mid + feesOn(mid, p.landPurchaseFeeBands) > budget) hi = mid;
    else lo = mid;
  }
  const residual = budget > 0 ? lo : budget; // negative when the scheme does not pay

  let withLand: FinanceResult["withLand"];
  if (p.landPrice !== undefined && p.landPrice > 0) {
    const landFees = feesOn(p.landPrice, p.landPurchaseFeeBands);
    const totalCost = devCost + p.landPrice + landFees;
    const profit = gdv - totalCost;
    withLand = { landPrice: r0(p.landPrice), landFees: r0(landFees), totalCost: r0(totalCost), profit: r0(profit), marginOnGdv: gdv ? profit / gdv : 0, marginOnCost: totalCost ? profit / totalCost : 0 };
  }

  const grossAnnual = a.residentialNetM2 * p.rentPerM2Month * 12;
  const netAnnual = grossAnnual * (1 - p.rentCostsPct);
  const investment = devCost + (withLand ? withLand.landPrice + withLand.landFees : Math.max(0, residual) + feesOn(Math.max(0, residual), p.landPurchaseFeeBands));
  return {
    currency: p.currency,
    gdv: r0(gdv),
    gdvBreakdown: { residential: r0(residential), commercial: r0(commercial), verandas: r0(verandas) },
    hardCost: r0(hardCost),
    hardBreakdown: { building: r0(building), verandas: r0(verandaCost), basement: r0(basement), external: r0(external) },
    softCost: r0(softCost),
    softBreakdown: { design: r0(design), permits: r0(permits), legal: r0(legal), contingency: r0(contingency), marketing: r0(marketing), finance: r0(financeCost) },
    devCost: r0(devCost),
    surplusBeforeLand: r0(surplus),
    residualLandValue: r0(residual),
    residualLandFees: r0(budget > 0 ? feesOn(lo, p.landPurchaseFeeBands) : 0),
    ...(withLand ? { withLand } : {}),
    rental: {
      grossAnnual: r0(grossAnnual),
      netAnnual: r0(netAnnual),
      grossYield: gdv ? grossAnnual / gdv : 0,
      netYield: gdv ? netAnnual / gdv : 0,
      onCost: investment > 0 ? netAnnual / investment : 0,
    },
  };
}
