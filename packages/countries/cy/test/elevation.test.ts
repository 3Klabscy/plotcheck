import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Parcel } from "@plotcheck/core";
import type { ProviderContext } from "@plotcheck/country-sdk";
import { chooseInterval, contourLines, dtmTilesAt, groundElevation, larnacaAirport, lzwDecode, readPixel } from "../src/index.ts";
import { cyPlotElevation, cyPlotStructures } from "../src/site.ts";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

/** A small uncompressed, tiled, float32 GeoTIFF (lat/lng), the same layout as the DLS DTM tiles. */
function makeTiff(opts: { x0: number; y0: number; px: number; w: number; h: number; value: (c: number, r: number) => number; nodata?: number }): Uint8Array {
  const T = 16;
  const across = Math.ceil(opts.w / T), down = Math.ceil(opts.h / T);
  const blocks: Uint8Array[] = [];
  for (let br = 0; br < down; br++)
    for (let bc = 0; bc < across; bc++) {
      const b = new DataView(new ArrayBuffer(T * T * 4));
      for (let r = 0; r < T; r++) for (let c = 0; c < T; c++) b.setFloat32((r * T + c) * 4, opts.value(bc * T + c, br * T + r), true);
      blocks.push(new Uint8Array(b.buffer));
    }
  const nodata = new TextEncoder().encode(`${opts.nodata ?? -9999}\0`);
  const entries: [number, number, number, number | number[] | Uint8Array][] = [
    [256, 3, 1, opts.w], [257, 3, 1, opts.h], [258, 3, 1, 32], [259, 3, 1, 1], [277, 3, 1, 1], [317, 3, 1, 1],
    [322, 3, 1, T], [323, 3, 1, T], [324, 4, blocks.length, []], [325, 4, blocks.length, blocks.map((b) => b.length)], [339, 3, 1, 3],
    [33550, 12, 3, [opts.px, opts.px, 0]], [33922, 12, 6, [0, 0, 0, opts.x0, opts.y0, 0]], [42113, 2, nodata.length, nodata],
  ];
  const ifdAt = 8, ifdLen = 2 + entries.length * 12 + 4;
  let extraAt = ifdAt + ifdLen;
  const extra: { at: number; bytes: Uint8Array }[] = [];
  const dataStart = extraAt + 2048;
  const offsets: number[] = [];
  let pos = dataStart;
  for (const b of blocks) { offsets.push(pos); pos += b.length; }
  const file = new Uint8Array(pos);
  const dv = new DataView(file.buffer);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdAt, true);
  dv.setUint16(ifdAt, entries.length, true);
  entries.forEach(([tag, type, count, v], i) => {
    const o = ifdAt + 2 + i * 12;
    dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true);
    const val = tag === 324 ? offsets : v;
    if (typeof val === "number") { if (type === 3) dv.setUint16(o + 8, val, true); else dv.setUint32(o + 8, val, true); return; }
    const size = type === 12 ? 8 : type === 2 ? 1 : 4;
    const bytes = new Uint8Array(count * size);
    const bdv = new DataView(bytes.buffer);
    if (val instanceof Uint8Array) bytes.set(val);
    else val.forEach((x, k) => (type === 12 ? bdv.setFloat64(k * 8, x, true) : bdv.setUint32(k * 4, x, true)));
    if (bytes.length <= 4) { file.set(bytes, o + 8); return; }
    dv.setUint32(o + 8, extraAt, true);
    extra.push({ at: extraAt, bytes });
    extraAt += bytes.length + (bytes.length % 2);
  });
  for (const e of extra) file.set(e.bytes, e.at);
  blocks.forEach((b, i) => file.set(b, offsets[i]!));
  return file;
}

function rangeFetch(files: (url: string) => Uint8Array | undefined, log: string[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const f = files(String(url));
    log.push(String(url));
    if (!f) return new Response("not found", { status: 404 });
    const m = /bytes=(\d+)-(\d+)/.exec((init?.headers as Record<string, string>)?.["Range"] ?? "");
    if (!m) return new Response(f, { status: 200 });
    return new Response(f.subarray(Number(m[1]), Number(m[2]) + 1), { status: 206 });
  }) as typeof fetch;
}

describe("DLS terrain model reader", () => {
  const tiff = makeTiff({ x0: 33.6, y0: 34.95, px: 0.0001, w: 40, h: 30, value: (c, r) => (c === 5 && r === 5 ? -9999 : 10 + c + r / 100) });
  const ctx: ProviderContext = { fetch: rangeFetch(() => tiff), env: () => undefined };
  const at = (c: number, r: number) => ({ lng: 33.6 + (c + 0.5) * 0.0001, lat: 34.95 - (r + 0.5) * 0.0001 });

  it("reads the pixel under a point, across internal tiles", async () => {
    expect(await readPixel(ctx, "mem://a", at(0, 0))).toBeCloseTo(10, 4);
    expect(await readPixel(ctx, "mem://a", at(37, 21))).toBeCloseTo(47.21, 4);
    expect(await readPixel(ctx, "mem://a", at(17, 3))).toBeCloseTo(27.03, 4);
  });
  it("returns nothing for nodata and outside the raster", async () => {
    expect(await readPixel(ctx, "mem://a", at(5, 5))).toBeUndefined();
    expect(await readPixel(ctx, "mem://a", { lng: 33.5, lat: 34.95 })).toBeUndefined();
  });
  it("decodes TIFF LZW exactly (a real block of DLS tile 2550-3650, values checked with PIL)", () => {
    const raw = new Uint8Array(fx("dtm-lzw-block.bin"));
    const want = JSON.parse(fx("dtm-lzw-block.json").toString()) as Record<string, number>;
    const out = lzwDecode(raw, 128 * 128 * 4);
    const dv = new DataView(out.buffer);
    for (const [i, v] of Object.entries(want)) {
      const got = dv.getFloat32(Number(i) * 4, true);
      if (v < -1e30) expect(got).toBeLessThan(-1e30);
      else expect(got).toBeCloseTo(v, 3);
    }
  });
  it("finds the tile for a Larnaca point in the DLS index", () => {
    expect(dtmTilesAt({ lng: 33.615, lat: 34.93 }).map((t) => t.pin)).toContain("2550-3650");
  });
});

describe("ground elevation and the airport height limit", () => {
  // A flat 6.0 m DTM 2019 tile covering the area around Larnaca airport
  const ground = makeTiff({ x0: 33.55, y0: 34.95, px: 0.002, w: 60, h: 50, value: () => 6 });
  const log: string[] = [];
  const ctx: ProviderContext = { fetch: rangeFetch((u) => (u.includes("/2019_DTM/") ? ground : undefined), log), env: () => undefined };
  const square = (lng: number, lat: number, d = 0.0002): Parcel =>
    ({ nationalRef: "x", geometry: { type: "Polygon", coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] }, identifiers: {}, provenance: { source: "t", status: "verified" } }) as unknown as Parcel;

  it("uses the DLS 2019 DTM", async () => {
    const e = await groundElevation(ctx, { lng: 33.6, lat: 34.9 });
    expect(e).toEqual({ elevationM: 6, source: "DTM 2019", resolutionM: 1 });
    expect(log.some((u) => /2019_DTM\/ETRS89_\d+_\d+\.tif$/.test(u))).toBe(true);
  });
  it("gives the plot's ground range", async () => {
    const e = (await cyPlotElevation(ctx, square(33.62, 34.9)))!;
    expect([e.minM, e.maxM, e.source]).toEqual([6, 6, "DTM 2019"]);
    expect(e.points).toBeGreaterThan(3);
  });
  it("turns the obstacle surface altitude into a building height cap", async () => {
    const hits = await larnacaAirport.check(ctx, square(33.6, 34.905));
    const ols = hits.find((h) => h.layerId === "airport:ols")!;
    expect(ols.messageKey).toBe("cy.restrict.olsHeight");
    expect(ols.params?.["ground"]).toBe(6);
    const altitude = ols.params?.["altitude"] as number;
    expect(ols.effect).toEqual({ type: "cap_height", maxHeightM: Math.floor((altitude - 6) * 10) / 10 });
  });
});

describe("contours", () => {
  it("traces a level through a sloping grid and joins the pieces into one line", () => {
    // 6 × 4 grid rising 1 m per column eastwards: the 2.5 m contour is one north–south line
    const g = { cols: 6, rows: 4, x0: 0, y0: 4, dx: 1, dy: 1, values: new Float32Array(24).map((_, i) => i % 6) };
    const lines = contourLines(g, [2.5]).get(2.5)!;
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toHaveLength(4);
    for (const [x] of lines[0]!) expect(x).toBeCloseTo(2.5, 6);
  });
  it("skips cells without data", () => {
    const vals = new Float32Array(24).map((_, i) => i % 6);
    vals[2] = NaN;
    const lines = contourLines({ cols: 6, rows: 4, x0: 0, y0: 4, dx: 1, dy: 1, values: vals }, [2.5]).get(2.5)!;
    expect(lines.flat().length).toBe(3);
  });
  it("chooses a readable interval for the relief", () => {
    expect(chooseInterval(5, 15)).toBe(0.5);
    expect(chooseInterval(300, 340)).toBe(2);
    expect(chooseInterval(0, 1900)).toBe(100);
  });
});

describe("what stands on the plot (DSM − DTM)", () => {
  // ground 10 m everywhere; surface 18 m (an 8 m building) on the western half of the box
  const dtm = makeTiff({ x0: 33.61, y0: 34.94, px: 0.00001, w: 40, h: 40, value: () => 10 });
  const dsm = makeTiff({ x0: 33.61, y0: 34.94, px: 0.00001, w: 40, h: 40, value: (c) => (c < 20 ? 18 : 10.3) });
  const ctx: ProviderContext = { fetch: rangeFetch((u) => (u.includes("/2019_DSM/") ? dsm : u.includes("/2019_DTM/") ? dtm : undefined)), env: () => undefined };
  it("measures the raised area and its height inside the plot", async () => {
    const d = 0.0004;
    const plot = { geometry: { type: "Polygon", coordinates: [[[33.61, 34.94 - d], [33.61 + d, 34.94 - d], [33.61 + d, 34.94], [33.61, 34.94], [33.61, 34.94 - d]]] } } as unknown as Parcel;
    const s = (await cyPlotStructures(ctx, plot))!;
    expect(s.raisedShare).toBeGreaterThan(0.4);
    expect(s.raisedShare).toBeLessThan(0.6);
    expect(s.maxHeightM).toBeCloseTo(8, 1);
  });
});
