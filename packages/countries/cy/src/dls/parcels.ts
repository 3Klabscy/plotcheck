import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import pointToPolygonDistance from "@turf/point-to-polygon-distance";
import type { LngLat, Parcel, PlotIdentifier, PolygonGeometry } from "@plotcheck/core";
import type { ParcelProvider, ProviderContext } from "@plotcheck/country-sdk";
import { parseCadastralParcels, type RawCadastralParcel } from "./gml.ts";
import { DLS_INSPIRE, dlsGet } from "./http.ts";
import { formatNationalRef, parseNationalRef } from "../plotId.ts";

const MAPSERVER = `${DLS_INSPIRE}/CP_CadastralParcels/MapServer`;
const PARCEL_LAYER = 1; // "Cadastral Parcel Data"
const WFS = `${MAPSERVER}/exts/InspireFeatureDownload/service`;
const FES_NS = 'xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:cp="urn:x-inspire:specification:gmlas:CadastralParcels:3.0"';

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** National refs look like "4000-40/56W1-3-1-666". Reject anything else before it reaches a query. */
const SAFE_REF = /^[0-9A-Za-z/._-]{3,60}$/;

function toParcel(raw: RawCadastralParcel, fetchedAt: string, providerId: string, source: string, sourceRef: string): Parcel {
  const ids = parseNationalRef(raw.nationalRef) ?? { nationalRef: raw.nationalRef };
  const municipality = ids["municipalityCode"];
  return {
    countryCode: "CY",
    providerId,
    providerParcelId: raw.localId,
    nationalRef: raw.nationalRef,
    label: raw.label,
    identifiers: ids,
    geometry: raw.geometry,
    officialAreaM2: raw.areaM2,
    adminUnits: municipality
      ? [{ level: 1, code: "CY" }, { level: 2, code: municipality.slice(0, 1) }, { level: 3, code: municipality }]
      : [{ level: 1, code: "CY" }],
    provenance: { source, sourceRef, fetchedAt, status: "verified" }, // official cadastral data as published
  };
}

/** Containing parcel first (distance 0), then neighbours by distance from the point. */
function byDistance(parcels: Parcel[], point: LngLat): Parcel[] {
  const pt: [number, number] = [point.lng, point.lat];
  return parcels
    .map((p) => {
      const inside = booleanPointInPolygon(pt, p.geometry);
      const dist = inside ? 0 : Math.abs(pointToPolygonDistance(pt, p.geometry, { units: "meters" }));
      return { ...p, distanceM: Math.round(dist * 10) / 10 };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}

function degBox(point: LngLat, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  return { w: point.lng - dLng, s: point.lat - dLat, e: point.lng + dLng, n: point.lat + dLat };
}

// ---------- Primary: ArcGIS REST query on the INSPIRE MapServer (~1 s) ----------

interface RestFeature {
  properties: { id_localId?: string; nationalCadastralRef?: string; label?: string; areaValue?: number; OBJECTID?: number };
  geometry: PolygonGeometry | null;
}

export function parseRestParcels(json: string): RawCadastralParcel[] {
  const d = JSON.parse(json) as { features?: RestFeature[]; error?: { message?: string } };
  if (d.error) throw new Error(`DLS REST error: ${d.error.message ?? "unknown"}`);
  return (d.features ?? [])
    .filter((f) => f.geometry && f.properties.nationalCadastralRef)
    .map((f) => ({
      gmlId: String(f.properties.OBJECTID ?? ""),
      localId: f.properties.id_localId ?? String(f.properties.OBJECTID ?? ""),
      label: f.properties.label,
      nationalRef: f.properties.nationalCadastralRef!,
      areaM2: typeof f.properties.areaValue === "number" ? f.properties.areaValue : undefined,
      geometry: f.geometry!,
    }));
}

const REST_FIELDS = "OBJECTID,id_localId,nationalCadastralRef,label,areaValue";
const restSource = "DLS INSPIRE Cadastral Parcels (ArcGIS REST)";
const restRef = (objectId: string) => `${MAPSERVER}/${PARCEL_LAYER}/query?objectIds=${objectId}&outFields=*&f=geojson`;

export const dlsRestParcels: ParcelProvider = {
  id: "cy.dls.rest.cp",
  name: "Department of Lands and Surveys — Cadastral Parcels (REST)",
  enabled: true,

  async getByPoint(ctx, point, opts) {
    const b = degBox(point, opts?.radiusM ?? 15);
    const url =
      `${MAPSERVER}/${PARCEL_LAYER}/query?geometry=${[b.w, b.s, b.e, b.n].map((v) => v.toFixed(7)).join(",")}` +
      `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${REST_FIELDS}` +
      `&returnGeometry=true&outSR=4326&resultRecordCount=30&f=geojson`;
    const fetchedAt = (ctx.now?.() ?? new Date()).toISOString();
    const raws = parseRestParcels(await dlsGet(ctx, url, 15_000));
    return byDistance(raws.map((r) => toParcel(r, fetchedAt, this.id, restSource, restRef(r.gmlId))), point);
  },

  async getById(ctx, id) {
    const ref = id["nationalRef"] ?? formatNationalRef(id);
    if (!ref || !SAFE_REF.test(ref)) return null;
    const where = encodeURIComponent(`nationalCadastralRef='${ref.replace(/'/g, "''")}'`);
    const url = `${MAPSERVER}/${PARCEL_LAYER}/query?where=${where}&outFields=${REST_FIELDS}&returnGeometry=true&outSR=4326&resultRecordCount=2&f=geojson`;
    const fetchedAt = (ctx.now?.() ?? new Date()).toISOString();
    const first = parseRestParcels(await dlsGet(ctx, url, 15_000))[0];
    return first ? toParcel(first, fetchedAt, this.id, restSource, restRef(first.gmlId)) : null;
  },

  /** As the DLS portal's "by plot" search: municipality + plot number, optionally quarter/sheet/block. */
  async search(ctx, id, opts) {
    const where = searchWhere(id);
    if (!where) return [];
    const limit = Math.min(opts?.limit ?? 50, 100);
    const url = `${MAPSERVER}/${PARCEL_LAYER}/query?where=${encodeURIComponent(where)}&outFields=${REST_FIELDS}&returnGeometry=true&outSR=4326&resultRecordCount=${limit}&orderByFields=nationalCadastralRef&f=geojson`;
    const fetchedAt = (ctx.now?.() ?? new Date()).toISOString();
    return parseRestParcels(await dlsGet(ctx, url, 20_000)).map((r) => toParcel(r, fetchedAt, this.id, restSource, restRef(r.gmlId)));
  },
};

const PART = /^[0-9A-Za-z/.]{1,20}$/;
/** SQL filter for a partial reference. Every part is validated, so nothing user-typed reaches SQL unchecked. */
export function searchWhere(id: Record<string, string | undefined>): string | null {
  const muni = id["municipalityCode"]?.trim();
  const plot = id["plot"]?.trim();
  if (!muni || !/^\d{4}$/.test(muni) || !plot || !PART.test(plot)) return null;
  const opt = (k: string) => {
    const v = id[k]?.trim();
    if (!v) return "%";
    return PART.test(v) ? v : null;
  };
  const sheet = opt("sheetPlan"), quarter = opt("quarter"), block = opt("block");
  if (sheet === null || quarter === null || block === null) return null;
  return `nationalCadastralRef LIKE '${muni}-${sheet}-${quarter}-${block}-${plot}'`;
}

// ---------- Fallback: INSPIRE WFS 2.0 download service (standard, but ~20 s per query) ----------

const wfsSource = "DLS INSPIRE Cadastral Parcels (WFS)";
const wfsRef = (gmlId: string) =>
  `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&STOREDQUERY_ID=urn:ogc:def:query:OGC-WFS::GetFeatureById&id=${encodeURIComponent(gmlId)}`;

export const dlsInspireParcels: ParcelProvider = {
  id: "cy.dls.inspire.cp",
  name: "Department of Lands and Surveys — INSPIRE Cadastral Parcels (WFS)",
  enabled: true,

  async getByPoint(ctx: ProviderContext, point: LngLat, opts?: { radiusM?: number }): Promise<Parcel[]> {
    const b = degBox(point, opts?.radiusM ?? 15);
    // EPSG:4258 in WFS 2.0 uses lat,lon axis order.
    const bbox = [b.s, b.w, b.n, b.e].map((v) => v.toFixed(7)).join(",");
    const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=cp:CadastralParcel&COUNT=30&BBOX=${bbox},urn:ogc:def:crs:EPSG::4258`;
    const xml = await dlsGet(ctx, url, 45_000);
    const fetchedAt = (ctx.now?.() ?? new Date()).toISOString();
    return byDistance(parseCadastralParcels(xml).map((raw) => toParcel(raw, fetchedAt, this.id, wfsSource, wfsRef(raw.gmlId))), point);
  },

  async getById(ctx: ProviderContext, id: PlotIdentifier): Promise<Parcel | null> {
    const ref = id["nationalRef"] ?? formatNationalRef(id);
    if (!ref || !SAFE_REF.test(ref)) return null;
    const filter = `<fes:Filter ${FES_NS}><fes:PropertyIsEqualTo><fes:ValueReference>cp:nationalCadastralReference</fes:ValueReference><fes:Literal>${escapeXml(ref)}</fes:Literal></fes:PropertyIsEqualTo></fes:Filter>`;
    const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=cp:CadastralParcel&COUNT=2&FILTER=${encodeURIComponent(filter)}`;
    const xml = await dlsGet(ctx, url, 45_000);
    const fetchedAt = (ctx.now?.() ?? new Date()).toISOString();
    const first = parseCadastralParcels(xml)[0];
    return first ? toParcel(first, fetchedAt, this.id, wfsSource, wfsRef(first.gmlId)) : null;
  },
};

/** PAL Surveying: no API or data licence yet (see TECHNICAL_PLAN §6 item 9). Never scrape. */
export const palSurveyParcels: ParcelProvider = {
  id: "cy.pal",
  name: "P.A.L. Land Surveying & GIS (licence pending)",
  enabled: false,
  async getByPoint() {
    throw new Error("PAL provider disabled: no licence/API agreement");
  },
  async getById() {
    throw new Error("PAL provider disabled: no licence/API agreement");
  },
};
