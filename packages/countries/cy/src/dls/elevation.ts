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
  offsets: { pos: number; type: number; count: number; inline?: number[] };
  counts: { pos: number; type: number; count: number; inline?: number[] };
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
  const arr = (t: number) => {
    const tag = tags.get(t)!;
    const size = TYPE_SIZE[tag.type] ?? 4;
    return { pos: tag.count * size <= 4 ? tag.at : tag.value, type: tag.type, count: tag.count };
  };
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
    offsets: arr(324),
    counts: arr(325),
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

async function readEntry(ctx: ProviderContext, url: string, info: TiffInfo, a: TiffInfo["offsets"], i: number): Promise<number> {
  const size = a.type === 3 ? 2 : 4;
  if (a.count * size <= 4) {
    const v = await range(ctx, url, a.pos, a.pos + 3);
    return a.type === 3 ? v.getUint16(i * 2, info.le) : v.getUint32(0, info.le);
  }
  const v = await range(ctx, url, a.pos + i * size, a.pos + i * size + size - 1);
  return a.type === 3 ? v.getUint16(0, info.le) : v.getUint32(0, info.le);
}

function readBlock(ctx: ProviderContext, url: string, info: TiffInfo, index: number): Promise<DataView | null> {
  const key = `${url}#${index}`;
  let p = blocks.get(key);
  if (!p) {
    p = (async () => {
      const [off, len] = await Promise.all([readEntry(ctx, url, info, info.offsets, index), readEntry(ctx, url, info, info.counts, index)]);
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
    if (blocks.size > 300) blocks.delete(blocks.keys().next().value!);
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
  const i = (row % info.tileH) * info.tileW + (col % info.tileW);
  const v =
    info.sampleFormat === 3 ? (info.bits === 64 ? block.getFloat64(i * 8, info.le) : block.getFloat32(i * 4, info.le))
    : info.bits === 16 ? (info.sampleFormat === 2 ? block.getInt16(i * 2, info.le) : block.getUint16(i * 2, info.le))
    : info.bits === 32 ? (info.sampleFormat === 2 ? block.getInt32(i * 4, info.le) : block.getUint32(i * 4, info.le))
    : block.getUint8(i);
  if (!Number.isFinite(v) || v < -1e30 || (info.nodata !== undefined && v === info.nodata)) return undefined;
  return v;
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
