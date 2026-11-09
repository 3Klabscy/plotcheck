// The user's own map layer: imported files (GeoJSON, KML, DXF) and drawings, with export.
// Coordinates outside lng/lat range are read as the country's national grid (e.g. CGRS93 / LTM
// for Cyprus, the usual coordinates in surveyors' DXF files).
import { fromGrid, toGrid, type NationalGrid } from "@plotcheck/core";

export type Pos = [number, number];
export type UserGeometry = { type: "Point"; coordinates: Pos } | { type: "LineString"; coordinates: Pos[] } | { type: "Polygon"; coordinates: Pos[][] };
export interface UserFeature {
  type: "Feature";
  id: string;
  properties: { name: string; source: "import" | "drawing"; layer?: string };
  geometry: UserGeometry;
}
export interface UserCollection { type: "FeatureCollection"; features: UserFeature[] }

let seq = 0;
const nextId = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;
export const feature = (geometry: UserGeometry, name: string, source: UserFeature["properties"]["source"], layer?: string): UserFeature => ({
  type: "Feature",
  id: nextId(),
  properties: { name, source, ...(layer ? { layer } : {}) },
  geometry,
});

export class ImportError extends Error {}

const isLngLat = (pts: Pos[]) => pts.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);

/** Convert positions to lng/lat: as is if they already are, else from the national grid. */
function normalise(fs: UserFeature[], grid?: NationalGrid): UserFeature[] {
  const all = fs.flatMap((f) => allPositions(f.geometry));
  if (all.length === 0) throw new ImportError("empty");
  if (isLngLat(all)) return fs;
  if (!grid) throw new ImportError("unknown_crs");
  const conv = (p: Pos): Pos => {
    const [lng, lat] = fromGrid(grid, p[0], p[1]);
    return [Math.round(lng * 1e8) / 1e8, Math.round(lat * 1e8) / 1e8];
  };
  return fs.map((f) => ({ ...f, geometry: mapGeometry(f.geometry, conv) }));
}

export function allPositions(g: UserGeometry): Pos[] {
  return g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates.flat();
}

function mapGeometry(g: UserGeometry, f: (p: Pos) => Pos): UserGeometry {
  if (g.type === "Point") return { type: "Point", coordinates: f(g.coordinates) };
  if (g.type === "LineString") return { type: "LineString", coordinates: g.coordinates.map(f) };
  return { type: "Polygon", coordinates: g.coordinates.map((r) => r.map(f)) };
}

// ---------- GeoJSON ----------

function fromGeoJson(text: string): UserFeature[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("bad_file");
  }
  const out: UserFeature[] = [];
  const add = (g: { type?: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined, name: string) => {
    if (!g) return;
    const c = g.coordinates as never;
    switch (g.type) {
      case "Point": out.push(feature({ type: "Point", coordinates: (c as number[]).slice(0, 2) as Pos }, name, "import")); break;
      case "MultiPoint": for (const p of c as number[][]) out.push(feature({ type: "Point", coordinates: p.slice(0, 2) as Pos }, name, "import")); break;
      case "LineString": out.push(feature({ type: "LineString", coordinates: (c as number[][]).map((p) => p.slice(0, 2) as Pos) }, name, "import")); break;
      case "MultiLineString": for (const l of c as number[][][]) out.push(feature({ type: "LineString", coordinates: l.map((p) => p.slice(0, 2) as Pos) }, name, "import")); break;
      case "Polygon": out.push(feature({ type: "Polygon", coordinates: (c as number[][][]).map((r) => r.map((p) => p.slice(0, 2) as Pos)) }, name, "import")); break;
      case "MultiPolygon": for (const poly of c as number[][][][]) out.push(feature({ type: "Polygon", coordinates: poly.map((r) => r.map((p) => p.slice(0, 2) as Pos)) }, name, "import")); break;
      case "GeometryCollection": for (const x of g.geometries ?? []) add(x as never, name); break;
    }
  };
  const d = data as { type?: string; features?: { geometry: never; properties?: Record<string, unknown> }[]; geometry?: never; properties?: Record<string, unknown> };
  const nameOf = (p?: Record<string, unknown>) => String(p?.["name"] ?? p?.["label"] ?? p?.["nationalRef"] ?? "");
  if (d.type === "FeatureCollection") for (const f of d.features ?? []) add(f.geometry, nameOf(f.properties));
  else if (d.type === "Feature") add(d.geometry ?? null, nameOf(d.properties));
  else add(d as never, "");
  return out;
}

// ---------- KML (no DOM needed, so it works on native too) ----------

const coordsOf = (s: string): Pos[] =>
  s.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((p) => p.length >= 2 && p.every((n) => Number.isFinite(n))).map((p) => [p[0]!, p[1]!]);
const tagText = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g"))].map((m) => m[1]!);
const unxml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();

function fromKml(text: string): UserFeature[] {
  if (!/<kml[\s>]/i.test(text)) throw new ImportError("bad_file");
  const out: UserFeature[] = [];
  for (const pm of tagText(text, "Placemark")) {
    const name = unxml(tagText(pm, "name")[0] ?? "");
    for (const poly of tagText(pm, "Polygon")) {
      const outer = tagText(tagText(poly, "outerBoundaryIs")[0] ?? "", "coordinates")[0];
      if (!outer) continue;
      const inner = tagText(poly, "innerBoundaryIs").map((b) => coordsOf(tagText(b, "coordinates")[0] ?? ""));
      out.push(feature({ type: "Polygon", coordinates: [coordsOf(outer), ...inner] }, name, "import"));
    }
    for (const ls of tagText(pm, "LineString")) out.push(feature({ type: "LineString", coordinates: coordsOf(tagText(ls, "coordinates")[0] ?? "") }, name, "import"));
    for (const pt of tagText(pm, "Point")) {
      const c = coordsOf(tagText(pt, "coordinates")[0] ?? "")[0];
      if (c) out.push(feature({ type: "Point", coordinates: c }, name, "import"));
    }
  }
  return out;
}

// ---------- DXF (ASCII; LWPOLYLINE, POLYLINE/VERTEX, LINE, POINT) ----------

function fromDxf(text: string): UserFeature[] {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]!.trim()), lines[i + 1]!.trim()]);
  const start = pairs.findIndex(([c, v], i) => c === 0 && v === "SECTION" && pairs[i + 1]?.[1] === "ENTITIES");
  if (start < 0) throw new ImportError("bad_file");
  const out: UserFeature[] = [];
  let i = start + 2;
  const entity = () => {
    const type = pairs[i]![1];
    const body: [number, string][] = [];
    i++;
    while (i < pairs.length && pairs[i]![0] !== 0) body.push(pairs[i++]!);
    return { type, body };
  };
  const xy = (body: [number, string][]) => {
    const pts: Pos[] = [];
    let x: number | undefined;
    for (const [c, v] of body) {
      if (c === 10) x = Number(v);
      else if (c === 20 && x !== undefined) { pts.push([x, Number(v)]); x = undefined; }
    }
    return pts;
  };
  const layerOf = (body: [number, string][]) => body.find(([c]) => c === 8)?.[1];
  const flags = (body: [number, string][]) => Number(body.find(([c]) => c === 70)?.[1] ?? 0);
  while (i < pairs.length) {
    const [code, value] = pairs[i]!;
    if (code === 0 && value === "ENDSEC") break;
    if (code !== 0) { i++; continue; }
    const e = entity();
    const layer = layerOf(e.body);
    if (e.type === "LWPOLYLINE") {
      const pts = xy(e.body);
      if (pts.length >= 2) out.push(closedOrLine(pts, (flags(e.body) & 1) === 1, layer));
    } else if (e.type === "POLYLINE") {
      const closed = (flags(e.body) & 1) === 1;
      const pts: Pos[] = [];
      while (i < pairs.length && pairs[i]![1] === "VERTEX") pts.push(...xy(entity().body));
      if (pairs[i]?.[1] === "SEQEND") entity();
      if (pts.length >= 2) out.push(closedOrLine(pts, closed, layer));
    } else if (e.type === "LINE") {
      const get = (c: number) => Number(e.body.find(([k]) => k === c)?.[1]);
      out.push(feature({ type: "LineString", coordinates: [[get(10), get(20)], [get(11), get(21)]] }, layer ?? "", "import", layer));
    } else if (e.type === "POINT") {
      const p = xy(e.body)[0];
      if (p) out.push(feature({ type: "Point", coordinates: p }, layer ?? "", "import", layer));
    }
  }
  return out;
}

function closedOrLine(pts: Pos[], closed: boolean, layer?: string): UserFeature {
  const first = pts[0]!, last = pts[pts.length - 1]!;
  const isClosed = closed || (pts.length > 3 && first[0] === last[0] && first[1] === last[1]);
  if (isClosed && pts.length >= 3) {
    const ring = first[0] === last[0] && first[1] === last[1] ? pts : [...pts, first];
    return feature({ type: "Polygon", coordinates: [ring] }, layer ?? "", "import", layer);
  }
  return feature({ type: "LineString", coordinates: pts }, layer ?? "", "import", layer);
}

/** Read a GeoJSON, KML or DXF file into lng/lat features. */
export function importFile(name: string, text: string, grid?: NationalGrid): UserFeature[] {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const fs = ext === "kml" ? fromKml(text) : ext === "dxf" ? fromDxf(text) : ext === "geojson" || ext === "json" ? fromGeoJson(text) : (() => { throw new ImportError("unsupported"); })();
  const valid = fs.filter((f) => allPositions(f.geometry).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  if (valid.length === 0) throw new ImportError("empty");
  return normalise(valid, grid).map((f) => ({ ...f, properties: { ...f.properties, name: f.properties.name || name } }));
}

// ---------- export ----------

const xml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

export function toKml(fc: UserCollection, title: string): string {
  const c = (pts: Pos[]) => `<coordinates>${pts.map((p) => `${p[0]},${p[1]},0`).join(" ")}</coordinates>`;
  const geom = (g: UserGeometry) =>
    g.type === "Point" ? `<Point>${c([g.coordinates])}</Point>`
    : g.type === "LineString" ? `<LineString>${c(g.coordinates)}</LineString>`
    : `<Polygon><outerBoundaryIs><LinearRing>${c(g.coordinates[0]!)}</LinearRing></outerBoundaryIs>${g.coordinates.slice(1).map((r) => `<innerBoundaryIs><LinearRing>${c(r)}</LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(title)}</name>
${fc.features.map((f) => `<Placemark><name>${xml(f.properties.name)}</name>${geom(f.geometry)}</Placemark>`).join("\n")}
</Document></kml>`;
}

export const toGeoJson = (fc: UserCollection) =>
  JSON.stringify({ type: "FeatureCollection", features: fc.features.map((f) => ({ type: "Feature", properties: { name: f.properties.name, ...(f.properties.layer ? { layer: f.properties.layer } : {}) }, geometry: f.geometry })) }, null, 1);

/** DXF R12 in the national grid (metres), the format engineers and surveyors open directly. */
export function toDxf(fc: UserCollection, grid: NationalGrid): string {
  const g = (p: Pos) => toGrid(grid, p[0], p[1]);
  const out: string[] = ["0", "SECTION", "2", "ENTITIES"];
  const layer = (f: UserFeature) => (f.properties.layer ?? f.properties.name ?? "PLOTCHECK").replace(/[^\w-]/g, "_").slice(0, 31) || "PLOTCHECK";
  for (const f of fc.features) {
    const geo = f.geometry;
    if (geo.type === "Point") {
      const [x, y] = g(geo.coordinates);
      out.push("0", "POINT", "8", layer(f), "10", x.toFixed(3), "20", y.toFixed(3), "30", "0.0");
      continue;
    }
    const rings = geo.type === "Polygon" ? geo.coordinates : [geo.coordinates];
    for (const ring of rings) {
      const closed = geo.type === "Polygon";
      const pts = closed && ring.length > 1 ? ring.slice(0, -1) : ring;
      out.push("0", "POLYLINE", "8", layer(f), "66", "1", "70", closed ? "1" : "0");
      for (const p of pts) {
        const [x, y] = g(p);
        out.push("0", "VERTEX", "8", layer(f), "10", x.toFixed(3), "20", y.toFixed(3), "30", "0.0");
      }
      out.push("0", "SEQEND");
    }
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n") + "\n";
}
