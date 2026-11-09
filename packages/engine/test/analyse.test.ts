import { describe, expect, it } from "vitest";
import { constant, type Provenance, type ZoneRuleSet } from "@plotcheck/core";
import { analyse, compareScenarios, splitFloors, type AnalysisParams } from "../src/index.ts";

const P: Provenance = { source: "test", status: "verified" };

function rules(over: Partial<ZoneRuleSet> = {}): ZoneRuleSet {
  return {
    schema: "ozfs-eu/0.1",
    jurisdiction: { path: ["XX"] },
    dist_abbr: "T1",
    uses_allowed: { value: ["apartment_block", "house", "row_houses", "mixed_use"], provenance: P },
    constraints: {
      far: constant("max", 1.2, P),
      lot_cov_bldg: constant("max", 0.5, P),
      stories: constant("max", 4, P),
      parking_per_unit: { min_val: [{ expression: [1, 1.5] }], provenance: P },
    },
    bonuses: [],
    provisions: [],
    curated: true,
    updatedAt: "2026-01-01",
    ...over,
  };
}

const params: AnalysisParams = {
  storeyHeightM: 3.2,
  netToGross: 0.82,
  unitMix: { studio: 0, bed1: 0, bed2: 1, bed3: 0 },
  unitSizeM2: { studio: 40, bed1: 60, bed2: 85, bed3: 115 },
  avgHouseSizeM2: 150,
  minRowHouseWidthM: 6,
};

describe("spec worked example: 530 m², density 1.20, coverage 50 %, 4 floors", () => {
  const r = analyse({ site: { officialAreaM2: 530 }, rules: rules(), use: "apartment_block", params });

  it("computes buildable area, coverage, floors and split", () => {
    expect(r.figures.maxGfaM2).toBe(636);
    expect(r.figures.maxCoverageM2).toBe(265);
    expect(r.figures.feasibleFloors).toBe(3);
    expect(r.figures.perFloorM2).toEqual([265, 265, 106]);
    expect(r.figures.achievableGfaM2).toBe(636);
  });

  it("estimates ~6 two-bedroom apartments and 6–9 parking spaces", () => {
    expect(r.units?.total).toBe(6);
    expect(r.units?.byType.bed2).toBe(6);
    expect(r.units?.parking).toEqual({ min: 6, max: 9 });
  });

  it("flags missing geometry for setbacks as maybe", () => {
    expect(r.checks.find((c) => c.id === "setbacks")?.status).toBe("maybe");
    expect(r.status).toBe("maybe");
  });
});

describe("checks", () => {
  it("rejects a use that the zone does not permit", () => {
    const r = analyse({ site: { officialAreaM2: 530 }, rules: rules(), use: "commercial", params });
    expect(r.checks.find((c) => c.id === "use")?.status).toBe("not_allowed");
    expect(r.status).toBe("not_allowed");
  });

  it("caps floors by max height", () => {
    const rs = rules();
    rs.constraints.height = constant("max", 7, P); // 7 / 3.2 → 2 floors
    const r = analyse({ site: { officialAreaM2: 530 }, rules: rs, use: "apartment_block", params });
    expect(r.figures.allowedFloors).toBe(2);
    expect(r.figures.achievableGfaM2).toBe(530); // 265 × 2, density not fully usable
    expect(r.checks.some((c) => c.id === "density_unused")).toBe(true);
  });

  it("uses the smaller of coverage and footprint after setbacks on the real shape", () => {
    // ~20 m × 26.5 m rectangle near Larnaca (≈530 m²); 3 m setback → ≈14 × 20.5 ≈ 287 m² > 265 coverage
    const lat = 34.92, lng = 33.62;
    const dLat = 26.5 / 111_320, dLng = 20 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const geometry = { type: "Polygon" as const, coordinates: [[[lng, lat], [lng + dLng, lat], [lng + dLng, lat + dLat], [lng, lat + dLat], [lng, lat]]] };
    const rs = rules();
    rs.constraints.setback_dist_boundary = constant("min", 3, P);
    const r = analyse({ site: { geometry }, rules: rs, use: "apartment_block", params });
    expect(r.figures.plotAreaM2).toBeGreaterThan(525);
    expect(r.figures.netFootprintM2!).toBeGreaterThan(275);
    expect(r.figures.netFootprintM2!).toBeLessThan(295);
    expect(r.figures.footprintM2).toBeCloseTo(r.figures.maxCoverageM2, 0);

    rs.constraints.setback_dist_boundary = constant("min", 5, P); // ≈10 × 16.5 = 165 < coverage
    const r2 = analyse({ site: { geometry }, rules: rs, use: "apartment_block", params });
    expect(r2.figures.footprintM2).toBeLessThan(175);
    expect(r2.figures.footprintM2).toBe(r2.figures.netFootprintM2);
    expect(r2.buildableFootprint?.type).toBe("Polygon");
  });

  it("evaluates conditional OZFS setbacks (more setback for taller buildings)", () => {
    const rs = rules();
    rs.constraints.height = constant("max", 13.5, P);
    rs.constraints.setback_dist_boundary = {
      min_val: [{ condition: "stories <= 2", expression: 3 }, { condition: true, expression: "3 + (stories - 2) * 0.5" }],
      provenance: P,
    };
    const r = analyse({ site: { officialAreaM2: 530 }, rules: rs, use: "house", params });
    expect(r.figures.allowedFloors).toBe(4);
    expect(r.figures.setbackM).toBe(4); // 3 + 2 × 0.5
  });

  it("returns maybe and a warning for needs_review values", () => {
    const rs = rules();
    rs.constraints.far = constant("max", 1.2, { source: "dls", status: "needs_review" });
    const r = analyse({ site: { officialAreaM2: 530 }, rules: rs, use: "apartment_block", params });
    expect(r.needsReview.map((w) => w.constraint)).toContain("far");
  });

  it("returns maybe when the permitted uses are unknown", () => {
    const r = analyse({ site: { officialAreaM2: 530 }, rules: rules({ uses_allowed: { value: null, provenance: P } }), use: "house", params });
    expect(r.checks.find((c) => c.id === "use")?.status).toBe("maybe");
  });
});

describe("helpers", () => {
  it("splits floors", () => expect(splitFloors(636, 265, 4)).toEqual([265, 265, 106]));
  it("ranks scenarios with permitted uses first", () => {
    const out = compareScenarios({ site: { officialAreaM2: 530 }, rules: rules(), params });
    expect(out.at(-1)?.use).toBe("commercial");
  });
});
