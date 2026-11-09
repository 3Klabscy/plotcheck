import { XMLParser } from "fast-xml-parser";
import type { PolygonGeometry } from "@plotcheck/core";

export interface RawCadastralParcel {
  gmlId: string;
  localId: string;
  label?: string;
  nationalRef: string;
  areaM2?: number;
  geometry: PolygonGeometry;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  isArray: (name) => ["member", "surfaceMember", "interior", "polygonMember"].includes(name),
  parseTagValue: false,
});

const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** GML posList in EPSG:4258 uses lat,lon axis order. Convert to GeoJSON [lon, lat]. */
export function posListToRing(posList: string, latLonOrder = true): number[][] {
  const n = posList.trim().split(/\s+/).map(Number);
  const ring: number[][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    const a = n[i]!, b = n[i + 1]!;
    ring.push(latLonOrder ? [b, a] : [a, b]);
  }
  const first = ring[0], last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
  return ring;
}

type GmlNode = Record<string, unknown>;
const text = (x: unknown): string | undefined => (x === undefined || x === null ? undefined : typeof x === "object" ? String((x as GmlNode)["#text"] ?? "") : String(x));

function ringOf(lr: unknown): number[][] {
  const pos = text((lr as GmlNode | undefined)?.["posList"]);
  if (!pos) throw new Error("LinearRing without posList");
  return posListToRing(pos);
}

function polygonCoords(poly: GmlNode): number[][][] {
  const ext = (poly["exterior"] as GmlNode | undefined)?.["LinearRing"];
  const rings = [ringOf(ext)];
  for (const i of asArray(poly["interior"] as GmlNode | GmlNode[] | undefined)) rings.push(ringOf(i["LinearRing"]));
  return rings;
}

export function parseGeometry(g: GmlNode): PolygonGeometry {
  if (g["Polygon"]) return { type: "Polygon", coordinates: polygonCoords(g["Polygon"] as GmlNode) };
  const ms = (g["MultiSurface"] ?? g["MultiPolygon"]) as GmlNode | undefined;
  if (ms) {
    const members = [...asArray(ms["surfaceMember"] as GmlNode[]), ...asArray(ms["polygonMember"] as GmlNode[])];
    const polys = members.map((m) => polygonCoords(m["Polygon"] as GmlNode));
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0]! } : { type: "MultiPolygon", coordinates: polys };
  }
  throw new Error(`Unsupported GML geometry: ${Object.keys(g).join(",")}`);
}

/** Parse an INSPIRE CP WFS 2.0 FeatureCollection (DLS). */
export function parseCadastralParcels(xml: string): RawCadastralParcel[] {
  const doc = parser.parse(xml) as GmlNode;
  const fc = doc["FeatureCollection"] as GmlNode | undefined;
  if (!fc) throw new Error("Not a WFS FeatureCollection");
  const out: RawCadastralParcel[] = [];
  for (const m of asArray(fc["member"] as GmlNode[])) {
    const p = m["CadastralParcel"] as GmlNode | undefined;
    if (!p) continue;
    const ident = (p["inspireId"] as GmlNode | undefined)?.["Identifier"] as GmlNode | undefined;
    const area = text(p["areaValue"]);
    out.push({
      gmlId: String(p["@id"] ?? ""),
      localId: text(ident?.["localId"]) ?? String(p["@id"] ?? ""),
      label: text(p["label"]),
      nationalRef: text(p["nationalCadastralReference"]) ?? "",
      areaM2: area ? Number(area) : undefined,
      geometry: parseGeometry(p["geometry"] as GmlNode),
    });
  }
  return out;
}

/** Parse an Esri WMS GetFeatureInfo text/xml response into attribute maps. */
export function parseFeatureInfo(xml: string): Record<string, string>[] {
  const doc = parser.parse(xml) as GmlNode;
  const r = doc["FeatureInfoResponse"] as GmlNode | string | undefined;
  if (!r || typeof r === "string") return [];
  return asArray(r["FIELDS"] as GmlNode | GmlNode[] | undefined).map((f) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (k.startsWith("@")) o[k.slice(1)] = String(v);
    return o;
  });
}
