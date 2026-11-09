import type { LngLat, Parcel, SiteContext, SiteElevation } from "@plotcheck/core";
import type { ProviderContext } from "@plotcheck/country-sdk";
import { DTM_SOURCE_URL, plotElevation } from "./dls/elevation.ts";
import { samplePoints } from "./dls/zones.ts";
import { larnacaRoadContext, planGroupsFromRoads } from "./larnaca/roads.ts";
import { larnacaStreetFrontage } from "./larnaca/frontage.ts";

/** Points to sample a plot's ground: interior points plus up to 12 boundary vertices. */
export function elevationPoints(parcel: Parcel): LngLat[] {
  const g = parcel.geometry;
  const ring = (g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0]?.[0]) ?? [];
  const step = Math.max(1, Math.ceil(ring.length / 12));
  const edge = ring.filter((_, i) => i % step === 0).map(([lng, lat]) => ({ lng: lng!, lat: lat! }));
  return [...samplePoints(parcel, 5), ...edge];
}

/** Ground elevation of the plot from the DLS terrain model (all of Cyprus). */
export async function cyPlotElevation(ctx: ProviderContext, parcel: Parcel): Promise<SiteElevation | undefined> {
  const e = await plotElevation(ctx, elevationPoints(parcel)).catch(() => undefined);
  if (!e) return undefined;
  return {
    minM: Math.round(e.minM * 10) / 10,
    maxM: Math.round(e.maxM * 10) / 10,
    meanM: e.meanM,
    points: e.samples.length,
    source: e.source,
    resolutionM: e.samples[0]!.resolutionM,
    provenance: { source: `DLS Digital Terrain Model (${e.source}), INSPIRE Elevation, CC BY-SA 4.0`, sourceRef: DTM_SOURCE_URL, status: "verified" },
  };
}

/** Road access, frontage and postcodes (Larnaca road-map area) and ground elevation (all Cyprus). */
export async function cySiteContextWithElevation(ctx: ProviderContext, parcel: Parcel): Promise<SiteContext | undefined> {
  const [site, elevation] = [cySiteContext(parcel), await cyPlotElevation(ctx, parcel)];
  if (!site && !elevation) return undefined;
  const base: SiteContext = site ?? { roadAccess: "unknown", frontage: [], postcodes: [], tags: [], provenance: { source: "DLS", status: "needs_review" } };
  return elevation ? { ...base, elevation } : base;
}

/** Road access, frontage and postcodes. Currently covers the Larnaca road-map area. */
export function cySiteContext(parcel: Parcel): SiteContext | undefined {
  const rc = larnacaRoadContext(parcel);
  if (!rc.covered) return undefined;
  const tags = new Set(planGroupsFromRoads(parcel, rc).map((g) => `cy.lca:${g}`));
  for (const f of larnacaStreetFrontage(parcel)) tags.add(`cy.lca:${f.group}`);
  return {
    roadAccess: rc.roadAccess,
    frontage: rc.frontage,
    postcodes: rc.postcodes,
    tags: [...tags],
    provenance: {
      source: "DLS INSPIRE road network + DLS Larnaca road map (names) + Cyprus Post postcodes",
      sourceRef: "https://portal.dls.moi.gov.cy/xartes_category/odikoi-chartes/",
      status: "needs_review",
    },
  };
}
