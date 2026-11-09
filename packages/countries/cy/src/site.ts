import type { LngLat, Parcel, SiteContext, SiteElevation, SiteStructures } from "@plotcheck/core";
import type { ProviderContext } from "@plotcheck/country-sdk";
import { DTM_SOURCE_URL, plotElevation, terrainGrid } from "./dls/elevation.ts";
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

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** Existing buildings/trees on the plot: DLS DSM 2019 minus DTM 2019, inside the plot boundary. */
export async function cyPlotStructures(ctx: ProviderContext, parcel: Parcel): Promise<SiteStructures | undefined> {
  const polys = parcel.geometry.type === "Polygon" ? [parcel.geometry.coordinates] : parcel.geometry.coordinates;
  const pts = polys.flatMap((p) => p[0] ?? []);
  const box: [number, number, number, number] = [Math.min(...pts.map((p) => p[0]!)), Math.min(...pts.map((p) => p[1]!)), Math.max(...pts.map((p) => p[0]!)), Math.max(...pts.map((p) => p[1]!))];
  const areaGuess = (box[2] - box[0]) * 91_300 * (box[3] - box[1]) * 111_000;
  if (areaGuess > 400_000) return undefined; // very large plots: skip (too many reads)
  const step = areaGuess > 60_000 ? 2 : 1;
  const dtm = await terrainGrid(ctx, box, step).catch(() => undefined);
  const dsm = dtm ? await terrainGrid(ctx, box, step, true, dtm).catch(() => undefined) : undefined;
  if (!dtm || !dsm) return undefined;
  const cellM2 = dtm.dx * 91_300 * dtm.dy * 111_000;
  const heights: number[] = [];
  let cells = 0;
  for (let r = 0; r < dtm.rows; r++)
    for (let c = 0; c < dtm.cols; c++) {
      const x = dtm.x0 + c * dtm.dx, y = dtm.y0 - r * dtm.dy;
      if (!polys.some((p) => inRing(x, y, p[0]!) && !p.slice(1).some((h) => inRing(x, y, h)))) continue;
      const g = dtm.values[r * dtm.cols + c]!, s = dsm.values[r * dtm.cols + c]!;
      if (Number.isNaN(g) || Number.isNaN(s)) continue;
      cells++;
      if (s - g >= 2.5) heights.push(s - g);
    }
  if (cells < 4) return undefined;
  heights.sort((a, b) => a - b);
  const p98 = heights.length ? heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.98))]! : 0;
  return {
    raisedM2: Math.round(heights.length * cellM2),
    raisedShare: Math.round((heights.length / cells) * 1000) / 1000,
    maxHeightM: Math.round(p98 * 10) / 10,
    source: "DSM 2019 − DTM 2019",
    provenance: { source: "DLS Digital Surface Model 2019 minus Digital Terrain Model 2019 (INSPIRE Elevation, CC BY-SA 4.0); buildings and trees are not told apart", sourceRef: DTM_SOURCE_URL, status: "needs_review" },
  };
}

/** Road access, frontage and postcodes (Larnaca road-map area), ground elevation and what stands on the plot (all Cyprus). */
export async function cySiteContextWithElevation(ctx: ProviderContext, parcel: Parcel): Promise<SiteContext | undefined> {
  const site = cySiteContext(parcel);
  const [elevation, structures] = await Promise.all([cyPlotElevation(ctx, parcel), cyPlotStructures(ctx, parcel).catch(() => undefined)]);
  if (!site && !elevation && !structures) return undefined;
  const base: SiteContext = site ?? { roadAccess: "unknown", frontage: [], postcodes: [], tags: [], provenance: { source: "DLS", status: "needs_review" } };
  return { ...base, ...(elevation ? { elevation } : {}), ...(structures ? { structures } : {}) };
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
