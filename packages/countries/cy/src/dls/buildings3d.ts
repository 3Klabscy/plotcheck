import type { ProviderContext, TerrainBuilding } from "@plotcheck/country-sdk";
import { DLS_INSPIRE, dlsGet } from "./http.ts";
import type { Grid } from "./elevation.ts";

/**
 * DLS building outlines (INSPIRE BU, "all footprints") with the surveyed heights: roof (ridge)
 * and eave above ground, roof type, floors. Checked 2026-11-10: REST query with GeoJSON output.
 */
export const BU_LAYER = `${DLS_INSPIRE}/BU_Buildings/MapServer/6`;

interface Feature {
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } | null;
  properties: { ROOF_TYPE?: string; H_ROOF_A_1?: number; H_EAVE_B_1?: number; FLOOR_QTY?: number };
}

export function roofKind(t: string | undefined): TerrainBuilding["roof"] {
  if (!t) return "mixed";
  if (/flat/i.test(t)) return "flat";
  if (/inclin|RT_In/i.test(t)) return "pitched";
  return "mixed";
}

function inRing(x: number, y: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Lowest ground under the outline and the typical (median) raised height from the surface model. */
function measure(rings: [number, number][][], ground: Grid, surface?: Grid): { groundM?: number; typicalM?: number } {
  const outer = rings[0]!;
  const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
  const c0 = Math.max(0, Math.floor((Math.min(...xs) - ground.x0) / ground.dx)), c1 = Math.min(ground.cols - 1, Math.ceil((Math.max(...xs) - ground.x0) / ground.dx));
  const r0 = Math.max(0, Math.floor((ground.y0 - Math.max(...ys)) / ground.dy)), r1 = Math.min(ground.rows - 1, Math.ceil((ground.y0 - Math.min(...ys)) / ground.dy));
  let gMin = Infinity;
  const raised: number[] = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const x = ground.x0 + c * ground.dx, y = ground.y0 - r * ground.dy;
      if (!inRing(x, y, outer) || rings.slice(1).some((h) => inRing(x, y, h))) continue;
      const g = ground.values[r * ground.cols + c]!;
      if (Number.isNaN(g)) continue;
      gMin = Math.min(gMin, g);
      const s = surface?.values[r * ground.cols + c];
      if (s !== undefined && !Number.isNaN(s)) raised.push(s - g);
    }
  raised.sort((a, b) => a - b);
  return {
    ...(Number.isFinite(gMin) ? { groundM: Math.round(gMin * 100) / 100 } : {}),
    ...(raised.length >= 4 ? { typicalM: Math.round(raised[Math.floor(raised.length / 2)]! * 10) / 10 } : {}),
  };
}

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

/** Ground and typical height of each building from the terrain / surface grids. */
export function measureBuildings(list: TerrainBuilding[], ground: Grid, surface?: Grid): TerrainBuilding[] {
  return list.map((b) => ({ ...b, ...measure(b.rings, ground, surface) }));
}

/** Buildings intersecting a lat/lng box (at most `max`). */
export async function cyBuildingsIn(ctx: ProviderContext, box: [number, number, number, number], max = 1500): Promise<TerrainBuilding[]> {
  const out: TerrainBuilding[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const url = `${BU_LAYER}/query?where=1%3D1&geometry=${box.join(",")}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&outFields=ROOF_TYPE,H_ROOF_A_1,H_EAVE_B_1,FLOOR_QTY&returnGeometry=true&geometryPrecision=7&resultOffset=${offset}&resultRecordCount=1000&f=geojson`;
    const fc = JSON.parse(await dlsGet(ctx, url, 15_000)) as { features?: Feature[]; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } };
    for (const f of fc.features ?? []) {
      if (!f.geometry) continue;
      const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
      const roofRaw = Number(f.properties.H_ROOF_A_1), eaveRaw = Number(f.properties.H_EAVE_B_1);
      if (!Number.isFinite(roofRaw) || roofRaw <= 0) continue;
      const roofM = Math.round(roofRaw * 100) / 100;
      const eaveM = Math.round(Math.min(roofM, Number.isFinite(eaveRaw) && eaveRaw > 0 ? eaveRaw : roofM) * 100) / 100;
      for (const poly of polys) {
        const rings = poly.map((ring) => ring.map((p) => [r7(p[0]!), r7(p[1]!)] as [number, number]));
        if (!rings[0] || rings[0].length < 4) continue;
        out.push({
          rings, roofM, eaveM, roof: roofKind(f.properties.ROOF_TYPE),
          ...(Number.isFinite(Number(f.properties.FLOOR_QTY)) && Number(f.properties.FLOOR_QTY) > 0 ? { floors: Number(f.properties.FLOOR_QTY) } : {}),
        });
      }
    }
    if ((fc.features?.length ?? 0) < 1000) break;
  }
  return out;
}
