import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveRules } from "@plotcheck/core";
import { analyse } from "@plotcheck/engine";
import type { ProviderContext } from "@plotcheck/country-sdk";
import {
  cyprus,
  dlsInspireParcels,
  dlsRestParcels,
  dlsPlanningZones,
  mapZoneAttributes,
  parseCadastralParcels,
  parseFeatureInfo,
  parseNationalRef,
  formatNationalRef,
  cySourceLayer,
  toZoneHit,
  cyRelaxationsFor,
  larnacaStreetFrontage,
  parseRestParcels,
} from "../src/index.ts";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** Fake fetch that serves fixtures by URL pattern and records calls. */
function ctxFor(routes: [RegExp, string][]): ProviderContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    env: () => undefined,
    now: () => new Date("2026-11-09T12:00:00Z"),
    fetch: (async (url: string) => {
      calls.push(String(url));
      const hit = routes.find(([re]) => re.test(String(url)));
      return new Response(hit ? fx(hit[1]) : "not found", { status: hit ? 200 : 404 });
    }) as typeof fetch,
  };
}

describe("GML parsing", () => {
  it("parses DLS WFS parcels with lat,lon → lon,lat axis swap", () => {
    const ps = parseCadastralParcels(fx("wfs-getfeature-bbox.xml"));
    expect(ps.length).toBe(3);
    const p = ps[0]!;
    expect(p.nationalRef).toBe("4000-40/640201-3-10-139");
    expect(p.label).toBe("139");
    expect(p.areaM2).toBe(213);
    expect(p.geometry.type).toBe("Polygon");
    const [lng, lat] = (p.geometry as { coordinates: number[][][] }).coordinates[0]![0]!;
    expect(lng).toBeCloseTo(33.62, 2);
    expect(lat).toBeCloseTo(34.92, 2);
  });

  it("parses WMS GetFeatureInfo planning zone attributes", () => {
    const z = mapZoneAttributes(parseFeatureInfo(fx("wms-gfi-ka4.xml"))[0]!)!;
    expect(z).toMatchObject({ zoneCode: "Κα4", density: 1.2, coverage: 0.5, heightM: 13.5, stories: 3, planRef: "401" });
    expect(z.planName).toBe("ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΑΡΝΑΚΑΣ");
  });

  it("handles zones without coefficients and empty responses", () => {
    const z = mapZoneAttributes(parseFeatureInfo(fx("wms-gfi-null.xml"))[0]!)!;
    expect(z.zoneCode).toBe("ΑΛ");
    expect(z.density).toBeUndefined();
    expect(parseFeatureInfo(fx("wms-gfi-empty.xml"))).toEqual([]);
  });
});

describe("national reference", () => {
  it("parses and re-formats", () => {
    const id = parseNationalRef("4000-40/56W1-3-1-666")!;
    expect(id).toMatchObject({ districtCode: "4", municipalityCode: "4000", sheetPlan: "40/56W1", block: "1", plot: "666" });
    expect(formatNationalRef(id)).toBe("4000-40/56W1-3-1-666");
    expect(parseNationalRef("garbage")).toBeNull();
  });
});

describe("providers (fixtures, no network)", () => {
  it("getByPoint returns the containing parcel first, then neighbours", async () => {
    const ctx = ctxFor([[/CP_CadastralParcels.*GetFeature/, "wfs-ka4.xml"]]);
    const ps = await dlsInspireParcels.getByPoint(ctx, { lng: 33.615, lat: 34.93 });
    expect(ps.length).toBe(6);
    expect(ps[0]!.distanceM).toBe(0);
    expect(ps[1]!.distanceM).toBeGreaterThanOrEqual(0);
    expect(ctx.calls[0]).toContain("urn:ogc:def:crs:EPSG::4258");
    expect(ctx.calls[0]).toMatch(/BBOX=34\.92\d+,33\.61/); // lat,lon order
  });

  it("zonesFor samples the parcel and aggregates zone hits", async () => {
    const parcels = parseCadastralParcels(fx("wfs-ka4.xml"));
    const ctx = ctxFor([[/LU_LandUse.*GetFeatureInfo/, "wms-gfi-ka4.xml"]]);
    const parcel = (await dlsInspireParcels.getByPoint(ctxFor([[/GetFeature/, "wfs-ka4.xml"]]), { lng: 33.615, lat: 34.93 }))[0]!;
    expect(parcels.length).toBeGreaterThan(0);
    const zones = await dlsPlanningZones.zonesFor(ctx, parcel);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ zoneCode: "Κα4", share: 1, planRef: "401" });
    expect(zones[0]!.jurisdiction.path).toEqual(["CY", "4", "4000"]);
    expect(ctx.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("end to end with fixtures: parcel → zone → rules → engine", () => {
  it("analyses a real Larnaca Κα4 parcel as an apartment block", async () => {
    const parcel = (await dlsInspireParcels.getByPoint(ctxFor([[/GetFeature/, "wfs-ka4.xml"]]), { lng: 33.615, lat: 34.93 }))[0]!;
    const z = mapZoneAttributes(parseFeatureInfo(fx("wms-gfi-ka4.xml"))[0]!)!;
    const hit = toZoneHit(z, parcel, 1, "2026-11-09T12:00:00Z");
    const rules = resolveRules(hit.jurisdiction, hit.zoneCode, [...cyprus.ruleLayers, cySourceLayer(hit)], hit.planRef);
    expect(rules.curated).toBe(true);
    expect(rules.plan?.name).toBe("ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΑΡΝΑΚΑΣ");

    const d = cyprus.defaults;
    const r = analyse({
      site: { geometry: parcel.geometry, officialAreaM2: parcel.officialAreaM2 },
      rules,
      use: "apartment_block",
      params: { storeyHeightM: d.storeyHeightM, netToGross: d.netToGrossResidential, unitMix: { studio: 0, bed1: 0.3, bed2: 0.5, bed3: 0.2 }, unitSizeM2: d.avgUnitSizeM2, avgHouseSizeM2: d.avgHouseSizeM2, minRowHouseWidthM: d.minRowHouseWidthM },
    });
    const A = parcel.officialAreaM2!;
    expect(r.figures.maxGfaM2).toBeCloseTo(A * 1.2, 0);
    expect(r.figures.maxCoverageM2).toBeCloseTo(A * 0.5, 0);
    expect(r.figures.allowedFloors).toBe(3);
    expect(r.figures.feasibleFloors).toBeLessThanOrEqual(3);
    expect(r.needsReview.length).toBeGreaterThan(0); // nothing verified yet → UI must warn
    expect(r.figures.netFootprintM2).toBeGreaterThan(0);
  });

  it("an uncovered zone still resolves from DLS data, flagged not curated", () => {
    const hit = toZoneHit({ zoneCode: "Κα5", density: 1, coverage: 0.5, stories: 3, heightM: 13.5, planRef: "401" }, { identifiers: { municipalityCode: "4000" } } as never, 1, "x");
    const rules = resolveRules(hit.jurisdiction, hit.zoneCode, [...cyprus.ruleLayers, cySourceLayer(hit)], hit.planRef);
    expect(rules.curated).toBe(false);
    expect(rules.constraints.far?.max_val?.[0]?.expression).toBe(1);
    expect(rules.constraints.setback_dist_boundary).toBeDefined(); // from the country layer
  });

  it("REST provider parses DLS GeoJSON and is tried before the WFS", async () => {
    const ctx = ctxFor([[/MapServer\/1\/query/, "rest-query-bbox.geojson"]]);
    const ps = await dlsRestParcels.getByPoint(ctx, { lng: 33.615, lat: 34.93 });
    expect(ps.length).toBe(6);
    expect(ps[0]).toMatchObject({ nationalRef: "4000-40/56W1-3-1-666", officialAreaM2: 698, distanceM: 0, providerId: "cy.dls.rest.cp" });
    expect(cyprus.parcelProviders.map((p) => p.id)).toEqual(["cy.dls.rest.cp", "cy.dls.inspire.cp", "cy.pal"]);
    expect(ctx.calls[0]).toContain("inSR=4326");
  });

  it("rejects unsafe references before querying", async () => {
    const ctx = ctxFor([]);
    expect(await dlsRestParcels.getById(ctx, { nationalRef: "1' OR '1'='1" })).toBeNull();
    expect(ctx.calls).toHaveLength(0);
  });

  it("PAL Survey provider is disabled", () => {
    expect(cyprus.parcelProviders.find((p) => p.id === "cy.pal")?.enabled).toBe(false);
  });
});

describe("continuous-building zones", () => {
  it("keeps the conservative 3 m setback but reports maybe with the 0 m alternative", () => {
    const hit = toZoneHit(
      { zoneCode: "Πα5", description: "ΠΕΡΙΟΧΕΣ ΠΥΡΗΝΩΝ ΚΑΙ ΣΥΝΕΧΟΥΣ ΔΟΜΗΣΗΣ", density: 2.1, coverage: 0.7, stories: 3, heightM: 10, planRef: "401" },
      { identifiers: { municipalityCode: "4000" } } as never, 1, "x",
    );
    const rules = resolveRules(hit.jurisdiction, hit.zoneCode, [...cyprus.ruleLayers, cySourceLayer(hit)], hit.planRef);
    const d = cyprus.defaults;
    const r = analyse({
      site: { officialAreaM2: 438 }, rules, use: "apartment_block",
      params: { storeyHeightM: d.storeyHeightM, netToGross: d.netToGrossResidential, unitMix: { studio: 0, bed1: 0, bed2: 1, bed3: 0 }, unitSizeM2: d.avgUnitSizeM2, avgHouseSizeM2: d.avgHouseSizeM2, minRowHouseWidthM: d.minRowHouseWidthM },
    });
    expect(r.figures.setbackM).toBe(3);
    expect(r.checks.find((c) => c.id === "setback_ambiguous")).toMatchObject({ status: "maybe", params: { min: 0, used: 3 } });
    expect(r.toBeChecked).toContain("check.engineer.setbacks");
  });
});

describe("Cyprus relaxations catalogue", () => {
  const hit = (zoneCode: string, description: string, planRef = "401", planName = "ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΑΡΝΑΚΑΣ") =>
    toZoneHit({ zoneCode, description, planRef, planName, density: 1.2, coverage: 0.5, stories: 3, heightM: 13.5 }, { identifiers: { municipalityCode: "4000" } } as never, 1, "x");
  const ids = (z: ReturnType<typeof hit>) => cyRelaxationsFor(z, 1.2).map((r) => r.id);

  it("applies island-wide relaxations everywhere, each with an instrument and source", () => {
    const list = cyRelaxationsFor(hit("Κα4", "ΠΕΡΙΟΧΕΣ ΜΕ ΕΠΙΚΡΑΤΟΥΣΑ ΧΡΗΣΗ ΤΗΝ ΚΑΤΟΙΚΙΑ", "999", "ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΕΜΕΣΟΥ"), 1.2);
    for (const id of ["cy.o4-2026.verandas", "cy.o4-2026.basement", "cy.o4-2026.extra-floors", "cy.o4-2025.res", "cy.scheme.affordable-45"]) expect(list.map((r) => r.id)).toContain(id);
    for (const r of list) {
      expect(r.instrument.length).toBeGreaterThan(3);
      expect(r.provenance.sourceRef).toMatch(/^https:\/\//);
      expect(r.provenance.status).toBe("needs_review");
    }
    expect(list.some((r) => r.id.startsWith("cy.lca."))).toBe(false);
  });
  it("adds Larnaca Local Plan incentives only on plan 401", () => {
    expect(ids(hit("Κα4", "ΚΑΤΟΙΚΙΑ"))).toEqual(expect.arrayContaining(["cy.lca.listed-transfer", "cy.lca.unified-complex"]));
    expect(ids(hit("Κα4", "ΚΑΤΟΙΚΙΑ", "999", "ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΕΜΕΣΟΥ")).some((x) => x.startsWith("cy.lca."))).toBe(false);
  });

  const parcelFrom = (file: string, ref: string) => {
    const raw = parseRestParcels(fx(file)).find((r) => r.nationalRef === ref)!;
    return { geometry: raw.geometry, officialAreaM2: raw.areaM2, nationalRef: ref } as never;
  };

  it("detects frontage on a commercial axis and offers the §11.6.3 bonus (Makariou III)", () => {
    const parcel = parcelFrom("rest-makariou.geojson", "4000-41/490403-2-4-905");
    expect(larnacaStreetFrontage(parcel)[0]).toMatchObject({ id: "makariou", group: "axis" });
    const list = cyRelaxationsFor(hit("Εβ", "ΕΜΠΟΡΙΚΗ"), { baseFar: 1.4, parcel }).map((r) => r.id);
    expect(list).toEqual(expect.arrayContaining(["cy.lca.urban-axis-30", "cy.lca.urban-axis-50", "cy.lca.uc-housing-mix"]));
    expect(list).not.toContain("cy.lca.urban-kep");
  });

  it("detects Central Commercial Area streets (Ermou)", () => {
    const parcel = parcelFrom("rest-ermou.geojson", "4000-41/570103-1-4-545");
    expect(larnacaStreetFrontage(parcel).map((f) => f.group)).toContain("kep");
    expect(cyRelaxationsFor(hit("Εβ", "ΕΜΠΟΡΙΚΗ"), { baseFar: 2, parcel }).map((r) => r.id)).toContain("cy.lca.urban-kep");
  });

  it("finds no plan-street frontage for a residential plot away from the centre", () => {
    expect(larnacaStreetFrontage(parcelFrom("rest-query-bbox.geojson", "4000-40/56W1-3-1-666"))).toEqual([]);
  });

  it("offers 0 m side distances only in continuous-building zones", () => {
    expect(ids(hit("Πα5", "ΠΕΡΙΟΧΕΣ ΠΥΡΗΝΩΝ ΚΑΙ ΣΥΝΕΧΟΥΣ ΔΟΜΗΣΗΣ"))).toContain("cy.o4-2026.continuous");
    expect(ids(hit("Κα4", "ΚΑΤΟΙΚΙΑ"))).not.toContain("cy.o4-2026.continuous");
  });
  it("limits discretionary extra floors to 1 under the Policy Statement", () => {
    const r = cyRelaxationsFor(hit("Η2", "", "x", "ΔΗΛΩΣΗ ΠΟΛΙΤΙΚΗΣ ΓΙΑ ΤΗΝ ΥΠΑΙΘΡΟ")).find((x) => x.id === "cy.o4-2026.extra-floors");
    expect(r?.effect.floorsAdd).toBe(1);
  });
  it("every relaxation has el and en texts", () => {
    const all = [...cyRelaxationsFor(hit("Κα4", "ΚΑΤΟΙΚΙΑ")), ...cyRelaxationsFor(hit("Εβ", "ΕΜΠΟΡΙΚΗ")), ...cyRelaxationsFor(hit("Πα5", "ΣΥΝΕΧΟΥΣ ΔΟΜΗΣΗΣ")), ...cyRelaxationsFor(hit("Η2", "", "x", "ΔΗΛΩΣΗ ΠΟΛΙΤΙΚΗΣ"))];
    for (const r of all) for (const lng of ["el", "en"]) for (const k of [r.titleKey, r.grantKey, r.conditionsKey, r.cost?.noteKey, r.statusNoteKey].filter(Boolean) as string[]) {
      expect(cyprus.messages[lng]![k], `${lng}:${k}`).toBeTruthy();
    }
  });
});
