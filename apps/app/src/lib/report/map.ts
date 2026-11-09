// Map figure for the report: basemap tiles (XYZ) clipped to a frame, with the plot, the buildable
// footprint and neighbours drawn as vectors on top, a scale bar and a north arrow.
import { clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFImage } from "pdf-lib";
import type { PolygonGeometry } from "@plotcheck/core";
import { C, type ReportDoc } from "./doc";

const TILE = 256;
const R = 6378137;
const worldPx = (z: number) => TILE * 2 ** z;
const toPx = (lng: number, lat: number, z: number): [number, number] => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * worldPx(z), (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z)];
};

const rings = (g: PolygonGeometry): number[][][] => (g.type === "Polygon" ? g.coordinates : g.coordinates.flat()) as number[][][];

export interface MapFigureInput {
  /** XYZ tile URL template with {z}/{x}/{y}. */
  tileUrl?: string;
  maxZoom?: number;
  plot: PolygonGeometry;
  footprint?: PolygonGeometry;
  neighbours?: PolygonGeometry[];
  /** Fetch with a timeout; injected so tests can run offline. */
  fetchBytes?(url: string): Promise<Uint8Array | undefined>;
}

const defaultFetch = async (url: string) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
};

/** Draw the map figure at the current position; returns metres per point of the figure. */
export async function drawMapFigure(doc: ReportDoc, input: MapFigureInput, height = 300, captions?: { scale: (m: string) => string; north: string; legend: { label: string; color: "plot" | "footprint" }[] }) {
  const W = doc.contentW, H = height, k = 2; // tile pixels per PDF point (sharp in print)
  doc.ensure(H + 30);
  const x0 = doc.margin, top = doc.y;
  const pts = rings(input.plot).flat();
  const maxZ = Math.min(input.maxZoom ?? 19, 20);
  let z = maxZ;
  for (; z > 10; z--) {
    const p = pts.map(([lng, lat]) => toPx(lng!, lat!, z));
    const w = Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]));
    const h = Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1]));
    if (w * 1.5 <= W * k && h * 1.5 <= H * k) break;
  }
  const pp = pts.map(([lng, lat]) => toPx(lng!, lat!, z));
  const cx = (Math.min(...pp.map((q) => q[0])) + Math.max(...pp.map((q) => q[0]))) / 2;
  const cy = (Math.min(...pp.map((q) => q[1])) + Math.max(...pp.map((q) => q[1]))) / 2;
  const left = cx - (W * k) / 2, upper = cy - (H * k) / 2;
  /** lng/lat → point offset inside the frame (y down from the top edge). */
  const proj = (lng: number, lat: number): [number, number] => {
    const [px, py] = toPx(lng, lat, z);
    return [(px - left) / k, (py - upper) / k];
  };

  // frame background
  doc.page.drawRectangle({ x: x0, y: top - H, width: W, height: H, color: C.panel });

  // tiles
  if (input.tileUrl) {
    const fetchBytes = input.fetchBytes ?? defaultFetch;
    const tx0 = Math.floor(left / TILE), tx1 = Math.floor((left + W * k) / TILE);
    const ty0 = Math.floor(upper / TILE), ty1 = Math.floor((upper + H * k) / TILE);
    const jobs: Promise<{ img?: PDFImage; tx: number; ty: number }>[] = [];
    for (let tx = tx0; tx <= tx1; tx++)
      for (let ty = ty0; ty <= ty1; ty++)
        jobs.push(
          (async () => {
            const url = input.tileUrl!.replace("{z}", String(z)).replace("{x}", String(tx)).replace("{y}", String(ty));
            const b = await fetchBytes(url);
            if (!b || b.length < 4) return { tx, ty };
            try {
              const img = b[0] === 0xff && b[1] === 0xd8 ? await doc.pdf.embedJpg(b) : b[0] === 0x89 && b[1] === 0x50 ? await doc.pdf.embedPng(b) : undefined;
              return { img, tx, ty };
            } catch {
              return { tx, ty };
            }
          })(),
        );
    const tiles = await Promise.all(jobs);
    doc.page.pushOperators(pushGraphicsState(), rectangle(x0, top - H, W, H), clip(), endPath());
    for (const t of tiles) {
      if (!t.img) continue;
      const px = (t.tx * TILE - left) / k, py = (t.ty * TILE - upper) / k;
      doc.page.drawImage(t.img, { x: x0 + px, y: top - py - TILE / k, width: TILE / k, height: TILE / k });
    }
    doc.page.pushOperators(popGraphicsState());
  }

  // vectors (SVG path in frame coordinates, y down)
  const path = (g: PolygonGeometry) =>
    rings(g).map((r) => r.map(([lng, lat], i) => { const [x, y] = proj(lng!, lat!); return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`; }).join(" ") + " Z").join(" ");
  const inFrame = (g: PolygonGeometry) => rings(g).flat().some(([lng, lat]) => { const [x, y] = proj(lng!, lat!); return x > -50 && x < W + 50 && y > -50 && y < H + 50; });
  doc.page.pushOperators(pushGraphicsState(), rectangle(x0, top - H, W, H), clip(), endPath());
  for (const n of input.neighbours ?? []) if (inFrame(n)) doc.page.drawSvgPath(path(n), { x: x0, y: top, borderColor: C.line, borderWidth: 0.6 });
  doc.page.drawSvgPath(path(input.plot), { x: x0, y: top, color: C.plot, opacity: 0.16, borderColor: C.plot, borderWidth: 2 });
  if (input.footprint) doc.page.drawSvgPath(path(input.footprint), { x: x0, y: top, color: C.footprint, opacity: 0.35, borderColor: C.footprint, borderWidth: 1.2 });
  doc.page.pushOperators(popGraphicsState());

  // scale bar: a round length close to a quarter of the width
  const lat = pts.reduce((a, p) => a + p[1]!, 0) / pts.length;
  const mPerPt = ((2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / worldPx(z)) * k;
  const target = (W / 4) * mPerPt;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].reduce((b, v) => (v <= target ? v : b), 1);
  const barW = nice / mPerPt;
  const bx = x0 + 10, by = top - H + 12;
  doc.page.drawRectangle({ x: bx - 4, y: by - 6, width: barW + 8 + 40, height: 20, color: C.panel, opacity: 0.85 });
  doc.page.drawRectangle({ x: bx, y: by, width: barW, height: 3, color: C.ink });
  doc.page.drawText(doc.clean(captions?.scale(`${nice} m`) ?? `${nice} m`), { x: bx + barW + 5, y: by - 1, size: 7.5, font: doc.bold, color: C.ink });
  // north arrow
  const nx = x0 + W - 18, ny = top - 14;
  doc.page.drawSvgPath(`M0 0 L6 16 L0 12 L-6 16 Z`, { x: nx, y: ny, color: C.ink, borderColor: rgb(1, 1, 1), borderWidth: 0.6 });
  doc.page.drawText(doc.clean(captions?.north ?? "N"), { x: nx - 3, y: ny - 27, size: 8, font: doc.bold, color: C.ink });
  // frame border
  doc.page.drawRectangle({ x: x0, y: top - H, width: W, height: H, borderColor: C.line, borderWidth: 0.6 });
  doc.y = top - H - 6;

  // legend
  if (captions?.legend.length) {
    let lx = x0;
    for (const l of captions.legend) {
      const col = l.color === "plot" ? C.plot : C.footprint;
      doc.page.drawRectangle({ x: lx, y: doc.y - 8, width: 9, height: 7, color: col, opacity: 0.5, borderColor: col, borderWidth: 0.8 });
      const label = doc.clean(l.label);
      doc.page.drawText(label, { x: lx + 13, y: doc.y - 8, size: 7.5, font: doc.regular, color: C.muted });
      lx += 13 + doc.regular.widthOfTextAtSize(label, 7.5) + 16;
    }
    doc.y -= 14;
  }
  return { zoom: z, metresPerPoint: mPerPt };
}

