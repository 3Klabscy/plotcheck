import { describe, expect, it } from "vitest";
import { constant, type Provenance, type Relaxation, type ZoneRuleSet } from "@plotcheck/core";
import { analyse, bestDensityPackage, type AnalysisParams } from "../src/index.ts";

const P: Provenance = { source: "test", status: "verified" };
const rules = (over: Partial<ZoneRuleSet["constraints"]> = {}): ZoneRuleSet => ({
  schema: "ozfs-eu/0.1", jurisdiction: { path: ["XX"] }, dist_abbr: "R1",
  uses_allowed: { value: ["apartment_block", "house", "row_houses", "commercial", "mixed_use"], provenance: P },
  constraints: { far: constant("max", 1.2, P), lot_cov_bldg: constant("max", 0.5, P), stories: constant("max", 3, P), height: constant("max", 13.5, P), ...over },
  bonuses: [], provisions: [], curated: true, updatedAt: "x",
});
const params: AnalysisParams = { storeyHeightM: 3.2, netToGross: 0.82, unitMix: { studio: 0, bed1: 0, bed2: 1, bed3: 0 }, unitSizeM2: { studio: 40, bed1: 60, bed2: 85, bed3: 115 }, avgHouseSizeM2: 150, minRowHouseWidthM: 6 };
const R = (id: string, o: Partial<Relaxation>): Relaxation => ({ id, tier: "conditional", titleKey: id, grantKey: id, conditionsKey: id, instrument: "test", effect: {}, quantified: true, provenance: P, ...o });

describe("bestDensityPackage", () => {
  const res = R("res", { effect: { farPct: 0.05 }, cap: { group: "local", maxPct: 0.3 } });
  const social = R("social", { effect: { farPct: 0.25 }, cap: { group: "local", maxPct: 0.3 }, exclusiveGroup: "complex" });
  const unified = R("unified", { effect: { farPct: 0.05 }, cap: { group: "local", maxPct: 0.3 }, exclusiveGroup: "complex" });
  const national = R("national", { effect: { farPct: 0.45 }, exclusiveGroup: "nat", notCombinableWith: ["res", "soc*"] });
  it("respects caps and exclusive groups", () => {
    const { best } = bestDensityPackage([res, social, unified], 1);
    expect(best.set.map((r) => r.id).sort()).toEqual(["res", "social"]);
    expect(best.add).toBeCloseTo(0.3);
  });
  it("picks the largest legal package and honours notCombinableWith", () => {
    const { best, alternatives } = bestDensityPackage([res, social, national], 1);
    expect(best.set.map((r) => r.id)).toEqual(["national"]);
    expect(alternatives[0]?.set.map((r) => r.id).sort()).toEqual(["res", "social"]);
  });
  it("applies an absolute density ceiling", () => {
    expect(bestDensityPackage([R("big", { effect: { farPct: 1, maxFar: 3 } })], 2).best.add).toBeCloseTo(1);
  });
});

describe("relaxed scenario", () => {
  it("uses extra density, adds discretionary floors only when needed, reports excluded areas", () => {
    const r = analyse({
      site: { officialAreaM2: 530 }, rules: rules(), use: "apartment_block", params,
      relaxations: [
        R("bonus", { effect: { farPct: 0.45 } }),
        R("floors", { tier: "discretionary", effect: { floorsAdd: 2 } }),
        R("verandas", { tier: "entitlement", effect: { excludedVerandaPct: 0.25 } }),
        R("note", { quantified: false }),
      ],
    });
    expect(r.figures.achievableGfaM2).toBe(636);
    const x = r.relaxed!;
    expect(x.figures.maxGfaM2).toBeCloseTo(922.2, 1); // 530 × 1.74
    expect(x.figures.feasibleFloors).toBe(4); // 922 / 265 → 4 floors, +1 discretionary
    expect(x.applied.find((a) => a.id === "floors")?.contribution.floorsAdd).toBe(1);
    expect(x.applied.find((a) => a.id === "verandas")?.contribution.verandaM2).toBe(231);
    expect(x.notes.map((n) => n.id)).toEqual(["note"]);
    expect(x.status).toBe("maybe");
    expect(x.gain.gfaM2).toBeCloseTo(286.2, 1);
    expect(r.toBeChecked).toContain("check.engineer.relaxations");
  });

  it("does not add floors when the bonus already fits", () => {
    const r = analyse({
      site: { officialAreaM2: 530 }, rules: rules({ stories: constant("max", 5, P), height: constant("max", 20, P) }), use: "apartment_block", params,
      relaxations: [R("bonus", { effect: { farPct: 0.2 } }), R("floors", { tier: "discretionary", effect: { floorsAdd: 2 } })],
    });
    expect(r.relaxed!.applied.map((a) => a.id)).toEqual(["bonus"]);
  });

  it("applies a smaller boundary distance (continuous building)", () => {
    const lat = 34.92, lng = 33.62, d = 20 / 111_320, e = 20 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const geometry = { type: "Polygon" as const, coordinates: [[[lng, lat], [lng + e, lat], [lng + e, lat + d], [lng, lat + d], [lng, lat]]] };
    const rs = rules({ lot_cov_bldg: constant("max", 0.7, P), setback_dist_boundary: constant("min", 3, P) });
    const r = analyse({ site: { geometry }, rules: rs, use: "apartment_block", params, relaxations: [R("cont", { tier: "discretionary", effect: { setbackM: 0 } })] });
    expect(r.figures.footprintM2).toBeLessThan(200); // 14 × 14
    expect(r.relaxed!.figures.footprintM2).toBeGreaterThan(270); // 0.7 × 400
  });

  it("is omitted for uses that are not permitted", () => {
    const rs = rules();
    rs.uses_allowed = { value: ["house"], provenance: P };
    expect(analyse({ site: { officialAreaM2: 530 }, rules: rs, use: "commercial", params, relaxations: [R("b", { effect: { farPct: 0.1 } })] }).relaxed).toBeUndefined();
  });
});
