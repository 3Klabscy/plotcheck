// Ground elevation from the DLS Digital Terrain Model (INSPIRE Elevation, CC BY-SA 4.0).
//
//  - 2019 DTM, 1 m, 2.5 km tiles (GeoTIFF float32, LZW, 128×128 internal tiles, ETRS89 lat/lng);
//  - 2014 DTM tiles where 2019 is missing;
//  - 1993 DTM, 5 m, one island-wide GeoTIFF (uint16 metres) as the last fallback.
// Values are read with HTTP range requests (header, directory, one 128×128 block), so a lookup
// costs a few small requests, not a tile download. Headers and blocks are cached in memory.
// Checked 2026-11-09: the server answers Range with 206; heights are metres above mean sea level.
import type { LngLat } from "@plotcheck/core";
import type { ProviderContext } from "@plotcheck/country-sdk";
import indexData from "../../data/cy-dtm-index.json" with { type: "json" };

interface DtmIndex { base: string; tiles: [string, number, number, number, number, number][] }
const INDEX = indexData as unknown as DtmIndex;
const DTM_1993 = `${INDEX.base}/1993_DTM/Cyprus_Dem_raster5m_ETRS89.tif`;
export const DTM_SOURCE_URL = "https://eservices.dls.moi.gov.cy/inspire/rest/directories/arcgisforinspire/INSPIRE/EL1_MapServer/datasetatoma1.xml";

export interface ElevationSample {
  elevationM: number;
  source: "DTM 2019" | "DTM 2014" | "DTM 1993";
  resolutionM: number;
}

// ---------- minimal tiled GeoTIFF reader over HTTP range requests ----------

interface TiffInfo {
  le: boolean;
  width: number;
  height: number;
  bits: number;
  sampleFormat: number; // 1 uint, 2 int, 3 float
  compression: number; // 1 none, 5 LZW, 8/32946 deflate (unsupported)
  predictor: number;
  tileW: number;
  tileH: number;
  offsets: number[];
  counts: number[];
  x0: number;
  y0: number;
  sx: number;
  sy: number;
  nodata?: number;
}

async function range(ctx: ProviderContext, url: string, start: number, end: number): Promise<DataView> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  const onAbort = () => ac.abort();
  ctx.signal?.addEventListener("abort", onAbort);
  try {
    const res = await ctx.fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: ac.signal });
    if (res.status !== 206 && res.status !== 200) throw new Error(`DTM ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    // a server that ignores Range returns the whole file: cut out the part we asked for
    const part = res.status === 200 ? buf.subarray(start, end + 1) : buf;
    return new DataView(part.buffer, part.byteOffset, part.byteLength);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 };

const headers = new Map<string, Promise<TiffInfo>>();

function readHeader(ctx: ProviderContext, url: string): Promise<TiffInfo> {
  let p = headers.get(url);
  if (!p) {
    p = parseHeader(ctx, url);
    headers.set(url, p);
    p.catch(() => headers.delete(url));
    if (headers.size > 200) headers.delete(headers.keys().next().value!);
  }
  return p;
}

async function parseHeader(ctx: ProviderContext, url: string): Promise<TiffInfo> {
  const h = await range(ctx, url, 0, 7);
  const le = h.getUint16(0) === 0x4949;
  if (h.getUint16(2, le) !== 42) throw new Error("DTM: not a classic TIFF");
  const ifdAt = h.getUint32(4, le);
  const d = await range(ctx, url, ifdAt, ifdAt + 2 + 40 * 12 + 4);
  const n = d.getUint16(0, le);
  const tags = new Map<number, { type: number; count: number; value: number; at: number }>();
  for (let i = 0; i < n; i++) {
    const o = 2 + i * 12;
    const type = d.getUint16(o + 2, le);
    const count = d.getUint32(o + 4, le);
    const inline = (TYPE_SIZE[type] ?? 1) * count <= 4;
    const value = type === 3 && inline ? d.getUint16(o + 8, le) : d.getUint32(o + 8, le);
    tags.set(d.getUint16(o, le), { type, count, value, at: ifdAt + o + 8 });
  }
  const num = (t: number, dflt?: number) => tags.get(t)?.value ?? dflt ?? NaN;
  // GeoTIFF scale (33550), tie point (33922) and GDAL nodata (42113) live outside the IFD
  const extra = [33550, 33922, 42113].map((t) => tags.get(t)).filter((t) => t !== undefined);
  const lo = Math.min(...extra.map((t) => t.value)), hi = Math.max(...extra.map((t) => t.value + t.count * (TYPE_SIZE[t.type] ?? 1)));
  const x = await range(ctx, url, lo, hi);
  const dbl = (t: number, i: number) => x.getFloat64(tags.get(t)!.value - lo + i * 8, le);
  const nd = tags.get(42113);
  const nodataText = nd ? new TextDecoder().decode(new Uint8Array(x.buffer, x.byteOffset + nd.value - lo, nd.count)).replace(/\0/g, "").trim() : undefined;
  const arr = async (t: number): Promise<number[]> => {
    const tag = tags.get(t)!;
    const size = tag.type === 3 ? 2 : 4;
    if (tag.count * size <= 4) return tag.type === 3 ? [tag.value] : [tag.value];
    const v = await range(ctx, url, tag.value, tag.value + tag.count * size - 1);
    return Array.from({ length: tag.count }, (_, i) => (size === 2 ? v.getUint16(i * 2, le) : v.getUint32(i * 4, le)));
  };
  const [offsets, counts] = await Promise.all([arr(324), arr(325)]);
  if (!tags.has(322)) throw new Error("DTM: TIFF is not tiled");
  return {
    le,
    width: num(256),
    height: num(257),
    bits: num(258),
    sampleFormat: num(339, 1),
    compression: num(259, 1),
    predictor: num(317, 1),
    tileW: num(322),
    tileH: num(323),
    offsets,
    counts,
    sx: dbl(33550, 0),
    sy: dbl(33550, 1),
    x0: dbl(33922, 3),
    y0: dbl(33922, 4),
    ...(nodataText ? { nodata: Number(nodataText) } : {}),
  };
}

/** TIFF LZW (MSB-first codes, "early change"). */
export function lzwDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let op = 0, bitPos = 0, codeLen = 9;
  const dict: Uint8Array[] = [];
  const reset = () => {
    dict.length = 258;
    for (let i = 0; i < 256; i++) dict[i] = new Uint8Array([i]);
    codeLen = 9;
  };
  const read = () => {
    let v = 0;
    for (let i = 0; i < codeLen; i++) {
      const byte = input[(bitPos + i) >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += codeLen;
    return v;
  };
  const write = (s: Uint8Array) => {
    const n = Math.min(s.length, expected - op);
    out.set(s.subarray(0, n), op);
    op += n;
  };
  reset();
  let prev: Uint8Array | undefined;
  while (op < expected && bitPos + codeLen <= input.length * 8) {
    const code = read();
    if (code === 257) break;
    if (code === 256) {
      reset();
      prev = undefined;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length) entry = dict[code]!;
    else if (prev) {
      entry = new Uint8Array(prev.length + 1);
      entry.set(prev);
      entry[prev.length] = prev[0]!;
    } else break;
    write(entry);
    if (prev) {
      const add = new Uint8Array(prev.length + 1);
      add.set(prev);
      add[prev.length] = entry[0]!;
      dict.push(add);
    }
    prev = entry;
    if (dict.length + 1 >= 1 << codeLen && codeLen < 12) codeLen++;
  }
  return out;
}

const blocks = new Map<string, Promise<DataView | null>>();

function readBlock(ctx: ProviderContext, url: string, info: TiffInfo, index: number): Promise<DataView | null> {
  const key = `${url}#${index}`;
  let p = blocks.get(key);
  if (!p) {
    p = (async () => {
      const off = info.offsets[index], len = info.counts[index];
      if (!off || !len) return null;
      const raw = await range(ctx, url, off, off + len - 1);
      const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      const expected = info.tileW * info.tileH * (info.bits / 8);
      let data: Uint8Array;
      if (info.compression === 1) data = bytes;
      else if (info.compression === 5) data = lzwDecode(bytes, expected);
      else throw new Error(`DTM: compression ${info.compression} not supported`);
      if (info.predictor !== 1) throw new Error(`DTM: predictor ${info.predictor} not supported`);
      return new DataView(data.buffer, data.byteOffset, data.byteLength);
    })();
    blocks.set(key, p);
    p.catch(() => blocks.delete(key));
    if (blocks.size > 400) blocks.delete(blocks.keys().next().value!);
  }
  return p;
}

/** Value of the pixel containing the point, or undefined outside the raster / on nodata. */
export async function readPixel(ctx: ProviderContext, url: string, p: LngLat): Promise<number | undefined> {
  const info = await readHeader(ctx, url);
  const col = Math.floor((p.lng - info.x0) / info.sx);
  const row = Math.floor((info.y0 - p.lat) / info.sy);
  if (col < 0 || row < 0 || col >= info.width || row >= info.height) return undefined;
  const across = Math.ceil(info.width / info.tileW);
  const block = await readBlock(ctx, url, info, Math.floor(row / info.tileH) * across + Math.floor(col / info.tileW));
  if (!block) return undefined;
  return sample(info, block, (row % info.tileH) * info.tileW + (col % info.tileW));
}

function sample(info: TiffInfo, block: DataView, i: number): number | undefined {
  const v =
    info.sampleFormat === 3 ? (info.bits === 64 ? block.getFloat64(i * 8, info.le) : block.getFloat32(i * 4, info.le))
    : info.bits === 16 ? (info.sampleFormat === 2 ? block.getInt16(i * 2, info.le) : block.getUint16(i * 2, info.le))
    : info.bits === 32 ? (info.sampleFormat === 2 ? block.getInt32(i * 4, info.le) : block.getUint32(i * 4, info.le))
    : block.getUint8(i);
  if (!Number.isFinite(v) || v < -1e30 || (info.nodata !== undefined && v === info.nodata)) return undefined;
  return v;
}

export interface Grid {
  /** NaN = no data. Row 0 is the north edge. */
  values: Float32Array;
  cols: number;
  rows: number;
  /** Lng/lat of the centre of cell (0,0) and the cell size in degrees. */
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

/**
 * Values over a lat/lng box at `step` × native resolution (block-averaged), cells outside the
 * raster or without data are NaN. Reads every 128×128 block it needs, in parallel.
 */
export async function readWindow(ctx: ProviderContext, url: string, box: [number, number, number, number], step = 1, into?: Grid): Promise<Grid> {
  const info = await readHeader(ctx, url);
  const c0 = Math.max(0, Math.floor((box[0] - info.x0) / info.sx)), c1 = Math.min(info.width - 1, Math.floor((box[2] - info.x0) / info.sx));
  const r0 = Math.max(0, Math.floor((info.y0 - box[3]) / info.sy)), r1 = Math.min(info.height - 1, Math.floor((info.y0 - box[1]) / info.sy));
  const grid = into ?? {
    cols: Math.max(1, Math.ceil(((box[2] - box[0]) / info.sx) / step)),
    rows: Math.max(1, Math.ceil(((box[3] - box[1]) / info.sy) / step)),
    x0: box[0] + (info.sx * step) / 2,
    y0: box[3] - (info.sy * step) / 2,
    dx: info.sx * step,
    dy: info.sy * step,
    values: new Float32Array(0),
  };
  if (!into) grid.values = new Float32Array(grid.cols * grid.rows).fill(NaN);
  if (c1 < c0 || r1 < r0) return grid;
  const across = Math.ceil(info.width / info.tileW);
  const want: number[] = [];
  for (let br = Math.floor(r0 / info.tileH); br <= Math.floor(r1 / info.tileH); br++)
    for (let bc = Math.floor(c0 / info.tileW); bc <= Math.floor(c1 / info.tileW); bc++) want.push(br * across + bc);
  const got = new Map(await Promise.all(want.map(async (i) => [i, await readBlock(ctx, url, info, i).catch(() => null)] as const)));
  const sum = new Float64Array(grid.values.length), n = new Uint16Array(grid.values.length);
  for (let r = r0; r <= r1; r++) {
    const lat = info.y0 - (r + 0.5) * info.sy;
    const gr = Math.floor((grid.y0 + grid.dy / 2 - lat) / grid.dy);
    if (gr < 0 || gr >= grid.rows) continue;
    for (let c = c0; c <= c1; c++) {
      const lng = info.x0 + (c + 0.5) * info.sx;
      const gc = Math.floor((lng - (grid.x0 - grid.dx / 2)) / grid.dx);
      if (gc < 0 || gc >= grid.cols) continue;
      const block = got.get(Math.floor(r / info.tileH) * across + Math.floor(c / info.tileW));
      if (!block) continue;
      const v = sample(info, block, (r % info.tileH) * info.tileW + (c % info.tileW));
      if (v === undefined) continue;
      sum[gr * grid.cols + gc]! += v;
      n[gr * grid.cols + gc]!++;
    }
  }
  for (let k = 0; k < sum.length; k++) if (n[k]) grid.values[k] = sum[k]! / n[k]!;
  return grid;
}

/** Tiles of one product ("2019_DTM", "2019_DSM", "2014_DTM") that overlap a box. */
function tileUrls(box: [number, number, number, number], bit: number, product: string): string[] {
  return INDEX.tiles
    .filter(([, w, s, e, n, f]) => f & bit && w <= box[2] && e >= box[0] && s <= box[3] && n >= box[1])
    .map(([pin]) => `${INDEX.base}/${product}/ETRS89_${pin.replace("-", "_")}.tif`);
}

/** A DTM (or DSM) grid over a box, merged from all the tiles it touches. */
export async function terrainGrid(ctx: ProviderContext, box: [number, number, number, number], step: number, surface = false, like?: Grid): Promise<Grid | undefined> {
  const urls = surface ? tileUrls(box, 4, "2019_DSM") : tileUrls(box, 1, "2019_DTM");
  if (urls.length === 0) return undefined;
  // `like`: resample onto the same cells as another grid (e.g. DSM onto the DTM's cells)
  let grid: Grid | undefined = like ? { ...like, values: new Float32Array(like.values.length).fill(NaN) } : undefined;
  for (const u of urls) grid = await readWindow(ctx, u, box, step, grid).catch(() => grid);
  return grid;
}

// ---------- elevation lookup ----------

/** Tiles whose index footprint contains the point (footprints of neighbours overlap slightly). */
export function dtmTilesAt(p: LngLat): { pin: string; flags: number }[] {
  return INDEX.tiles
    .filter(([, w, s, e, n]) => p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n)
    .map(([pin, , , , , flags]) => ({ pin, flags }));
}

export async function groundElevation(ctx: ProviderContext, p: LngLat): Promise<ElevationSample | undefined> {
  const tiles = dtmTilesAt(p);
  for (const [bit, year] of [[1, "2019"], [2, "2014"]] as const) {
    for (const t of tiles.filter((x) => x.flags & bit)) {
      const v = await readPixel(ctx, `${INDEX.base}/${year}_DTM/ETRS89_${t.pin.replace("-", "_")}.tif`, p).catch(() => undefined);
      if (v !== undefined) return { elevationM: Math.round(v * 100) / 100, source: `DTM ${year}`, resolutionM: 1 };
    }
  }
  const v = await readPixel(ctx, DTM_1993, p).catch(() => undefined);
  // the 1993 model stores the sea as 0
  return v !== undefined && v > 0 ? { elevationM: v, source: "DTM 1993", resolutionM: 5 } : undefined;
}

/** Ground elevation at several points of a plot (lowest, highest, mean). */
export async function plotElevation(ctx: ProviderContext, points: LngLat[]) {
  const samples = (await Promise.all(points.map((p) => groundElevation(ctx, p)))).map((s, i) => (s ? { ...s, point: points[i]! } : undefined)).filter((s) => s !== undefined);
  if (samples.length === 0) return undefined;
  const values = samples.map((s) => s.elevationM);
  return {
    samples,
    minM: Math.min(...values),
    maxM: Math.max(...values),
    meanM: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
    source: samples[0]!.source,
  };
}
