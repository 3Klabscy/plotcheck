import type { Parcel } from "@plotcheck/core";
import type { ProviderContext, TerrainModel } from "@plotcheck/country-sdk";
import { DTM_SOURCE_URL, terrainGrid, type Grid } from "./elevation.ts";

const NODATA = -32768;
/** Longest side of the grid in cells: ~220 keeps a plot + 100 m at 1 m and the answer near 200 kB. */
const MAX_CELLS = 280;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Decimetres above base as Int16 LE, base64. */
export function encodeHeights(values: Float32Array, baseM: number): string {
  const out = new Int16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    out[i] = Number.isNaN(v) ? NODATA : Math.max(-32767, Math.min(32767, Math.round((v - baseM) * 10)));
  }
  return toBase64(new Uint8Array(out.buffer));
}

/** DLS DTM 2019 + DSM 2019 (1 m) over the plot and `bufferM` around it. */
export async function cyTerrainModel(ctx: ProviderContext, parcel: Parcel, bufferM: number): Promise<TerrainModel | undefined> {
  const polys = parcel.geometry.type === "Polygon" ? [parcel.geometry.coordinates] : parcel.geometry.coordinates;
  const pts = polys.flatMap((p) => p[0] ?? []);
  const lat = pts.reduce((a, p) => a + p[1]!, 0) / pts.length;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const bLng = bufferM / mLng, bLat = bufferM / mLat;
  const box: [number, number, number, number] = [
    Math.min(...pts.map((p) => p[0]!)) - bLng, Math.min(...pts.map((p) => p[1]!)) - bLat,
    Math.max(...pts.map((p) => p[0]!)) + bLng, Math.max(...pts.map((p) => p[1]!)) + bLat,
  ];
  const sideM = Math.max((box[2] - box[0]) * mLng, (box[3] - box[1]) * mLat);
  if (sideM > 3000) return undefined; // very large plots: too many reads
  const step = Math.max(1, Math.ceil(sideM / MAX_CELLS));
  const hasData = (g: Grid | undefined) => !!g && g.values.some((v) => !Number.isNaN(v));
  // ground (1 m) and surface (0.5 m: read at twice the step, which lands on the same cells) in
  // parallel; one retry if a read failed
  let [ground, surface] = await Promise.all([terrainGrid(ctx, box, step).catch(() => undefined), terrainGrid(ctx, box, step * 2, true).catch(() => undefined)]);
  if (!hasData(ground)) ground = await terrainGrid(ctx, box, step).catch(() => undefined);
  if (!ground || !hasData(ground)) return undefined;
  if (surface && (surface.cols !== ground.cols || surface.rows !== ground.rows || Math.abs(surface.x0 - ground.x0) > ground.dx / 4))
    surface = await terrainGrid(ctx, box, step, true, ground).catch(() => undefined);
  let min = Infinity;
  for (const v of ground.values) if (!Number.isNaN(v) && v < min) min = v;
  const baseM = Math.floor(min);
  return {
    cols: ground.cols, rows: ground.rows,
    x0: ground.x0, y0: ground.y0, dx: ground.dx, dy: ground.dy,
    cellM: [ground.dx * mLng, ground.dy * mLat],
    baseM,
    ground: encodeHeights(ground.values, baseM),
    ...(surface && surface.values.some((v) => !Number.isNaN(v)) ? { surface: encodeHeights(surface.values, baseM) } : {}),
    box, bufferM,
    source: `DLS DTM 2019${surface ? " + DSM 2019" : ""}, ${Math.round(ground.dx * mLng * 10) / 10} m`,
    sourceRef: DTM_SOURCE_URL,
  };
}
