import { describe, expect, it } from "vitest";
import { feesOn, finance, type FinanceParams } from "../src/index.ts";

const P: FinanceParams = {
  currency: "EUR", salePricePerM2: 2500, commercialPricePerM2: 3000, verandaValueShare: 0.5,
  constructionCostPerM2: 1900, verandaCostShare: 0.5, basementLevels: 0, basementCostPerM2: 900,
  externalWorksPct: 0.05, designPct: 0.07, permitsPct: 0.015, legalPct: 0.01, contingencyPct: 0.05,
  marketingPctOfGdv: 0.03, financePct: 0.04, targetProfitPctOfGdv: 0.2,
  landPurchaseFeeBands: [{ upTo: 85000, rate: 0.03 }, { upTo: 170000, rate: 0.05 }, { upTo: null, rate: 0.08 }],
  rentPerM2Month: 12, rentCostsPct: 0.2,
};
const A = { gfaM2: 636, footprintM2: 265, residentialNetM2: 522, commercialNetM2: 0, verandaM2: 159 };

describe("finance", () => {
  it("computes fees by band", () => {
    expect(feesOn(50_000, P.landPurchaseFeeBands)).toBe(1500);
    expect(feesOn(200_000, P.landPurchaseFeeBands)).toBeCloseTo(85000 * 0.03 + 85000 * 0.05 + 30000 * 0.08);
  });
  it("sales value, costs, residual land value and profit at a given land price are consistent", () => {
    const f = finance(A, P);
    expect(f.gdv).toBe(Math.round(522 * 2500 + 159 * 2500 * 0.5));
    expect(f.hardCost).toBe(Math.round((636 * 1900 + 159 * 1900 * 0.5) * 1.05));
    expect(f.devCost).toBe(f.hardCost + f.softCost);
    // paying exactly the residual land value leaves the target profit (profitable case)
    const Q = { ...P, salePricePerM2: 3400, constructionCostPerM2: 1500 };
    const fq = finance(A, Q);
    expect(fq.residualLandValue).toBeGreaterThan(0);
    const g = finance(A, { ...Q, landPrice: fq.residualLandValue });
    expect(g.withLand!.marginOnGdv).toBeCloseTo(0.2, 2);
  });
  it("negative residual when the scheme does not pay", () => {
    expect(finance(A, { ...P, salePricePerM2: 1200 }).residualLandValue).toBeLessThan(0);
  });
  it("rental yield", () => {
    const f = finance(A, P);
    expect(f.rental.grossAnnual).toBe(522 * 12 * 12);
    expect(f.rental.netAnnual).toBe(Math.round(522 * 12 * 12 * 0.8));
  });
  it("sells the affordable share at the fixed price and the rest at market price", () => {
    const base = finance(A, P);
    const f = finance(A, { ...P, affordableBuildableM2: 100, affordablePricePerM2Buildable: 1650 });
    const net = 100 * (A.residentialNetM2 / A.gfaM2);
    expect(f.gdvBreakdown.affordable).toBe(165_000);
    expect(f.gdvBreakdown.residential).toBe(Math.round((A.residentialNetM2 - net) * P.salePricePerM2));
    expect(f.gdv).toBeLessThan(base.gdv);
  });
  it("adds a buy-out payment to the costs", () => {
    const f = finance(A, { ...P, schemeCompensation: 50_000 });
    expect(f.softBreakdown.compensation).toBe(50_000);
    expect(f.devCost).toBeGreaterThan(finance(A, P).devCost + 50_000); // finance cost on top
  });
});
