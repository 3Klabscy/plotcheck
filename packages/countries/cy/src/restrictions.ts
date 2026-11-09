import { decode } from "fast-png";
import simplify from "@turf/simplify";
import booleanIntersects from "@turf/boolean-intersects";
import type { LngLat, Parcel, Provenance } from "@plotcheck/core";
import type { ProviderContext, RestrictionHit, RestrictionLayer } from "@plotcheck/country-sdk";
import { DLS_INSPIRE, dlsGet } from "./dls/http.ts";
import { samplePoints } from "./dls/zones.ts";
import { groundElevation } from "./dls/elevation.ts";
import { elevationPoints } from "./site.ts";

/**
 * Restriction layers for Cyprus (researched 2026-11-09). Each hit carries its effect and source;
 * the engine applies the effect (block / height cap / note) and the UI shows the message.
 */

const prov = (source: string, sourceRef: string, page?: string): Provenance => ({
  source,
  sourceRef,
  ...(page ? { page } : {}),
  fetchedAt: new Date().toISOString(),
  status: "needs_review",
});

// ---------- helpers ----------
const R = 6_371_008.8;
const toXY = (lng: number, lat: number, lat0: number): [number, number] => [
  ((lng * Math.PI) / 180) * R * Math.cos((lat0 * Math.PI) / 180),
  ((lat * Math.PI) / 180) * R,
];
const outerRing = (p: Parcel) => (p.geometry.type === "Polygon" ? p.geometry.coordinates[0]! : p.geometry.coordinates[0]![0]!);
function bbox(p: Parcel) {
  const xs = outerRing(p).map((c) => c[0]!), ys = outerRing(p).map((c) => c[1]!);
  return { w: Math.min(...xs), s: Math.min(...ys), e: Math.max(...xs), n: Math.max(...ys) };
}
/** Esri JSON polygon; large plots are simplified (~2 m tolerance) to keep requests small. */
function esriPolygon(p: Parcel, maxVertices = 300): string {
  let g = p.geometry;
  let n = g.type === "Polygon" ? g.coordinates.flat().length : g.coordinates.flat(2).length;
  // progressively coarser until small enough (still ≤ ~10 m — far below the scale of these zones)
  for (const tol of [0.00002, 0.00005, 0.0001]) {
    if (n <= maxVertices) break;
    const f = simplify({ type: "Feature", properties: {}, geometry: p.geometry } as Parameters<typeof simplify>[0], { tolerance: tol, highQuality: false }) as unknown as { geometry: typeof g };
    g = f.geometry;
    n = g.type === "Polygon" ? g.coordinates.flat().length : g.coordinates.flat(2).length;
  }
  return JSON.stringify({ rings: g.type === "Polygon" ? g.coordinates : g.coordinates.flat(), spatialReference: { wkid: 4326 } });
}

/** ArcGIS REST query by POST (polygon geometries can exceed URL length limits). */
async function arcgisQuery(ctx: ProviderContext, url: string, params: Record<string, string>, timeoutMs = 25_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await ctx.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ f: "json", ...params }).toString(),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()) as { error?: { message?: string } };
    if (d.error) throw new Error(`ArcGIS: ${d.error.message ?? "error"}`);
    return d;
  } finally {
    clearTimeout(t);
  }
}
const polyQuery = (parcel: Parcel, outFields: string) => ({
  geometry: esriPolygon(parcel),
  geometryType: "esriGeometryPolygon",
  inSR: "4326",
  spatialRel: "esriSpatialRelIntersects",
  outFields,
  returnGeometry: "false",
});

// ---------- Natura 2000 (EEA, EU-wide) ----------
const EEA_N2K = "https://bio.discomap.eea.europa.eu/arcgis/rest/services/ProtectedSites/Natura2000Sites/MapServer/2/query";

export const natura2000: RestrictionLayer = {
  id: "natura2000",
  kind: "natura2000",
  enabled: true,
  async check(ctx, parcel) {
    const d = (await arcgisQuery(ctx, EEA_N2K, polyQuery(parcel, "SITECODE,SITENAME,SITETYPE"))) as { features?: { attributes: { SITECODE: string; SITENAME: string; SITETYPE: string } }[] };
    return (d.features ?? []).map((f): RestrictionHit => ({
      layerId: "natura2000",
      kind: "natura2000",
      severity: "critical",
      messageKey: "cy.restrict.natura",
      params: { code: f.attributes.SITECODE, name: f.attributes.SITENAME },
      effect: { type: "info" },
      provenance: prov("EEA Natura 2000 sites (Habitats & Birds Directives)", "https://bio.discomap.eea.europa.eu/arcgis/rest/services/ProtectedSites/Natura2000Sites/MapServer"),
    }));
  },
};

// ---------- Forest Department protected sites (DLS INSPIRE PS) ----------
export const forestSites: RestrictionLayer = {
  id: "forest",
  kind: "protected_site",
  enabled: true,
  async check(ctx, parcel) {
    // DLS rejects long URLs and large POST bodies: query by bounding box, then intersect exactly here
    const b = bbox(parcel);
    const url = `${DLS_INSPIRE}/PS_ProtectedSites/MapServer/1/query?geometry=${b.w},${b.s},${b.e},${b.n}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
    const raw = JSON.parse(await dlsGet(ctx, url)) as { features?: { attributes: Record<string, string>; geometry?: { rings: number[][][] } }[] };
    const plot = { type: "Feature", properties: {}, geometry: parcel.geometry } as Parameters<typeof booleanIntersects>[0];
    const d = { features: (raw.features ?? []).filter((f) => f.geometry && booleanIntersects(plot, { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: f.geometry.rings } } as Parameters<typeof booleanIntersects>[1])) };
    return (d.features ?? []).map((f): RestrictionHit => {
      const a = Object.fromEntries(Object.entries(f.attributes).map(([k, v]) => [k.split(".").at(-1)!, v]));
      return {
        layerId: "forest",
        kind: "protected_site",
        severity: "warning",
        messageKey: "cy.restrict.forest",
        params: { name: a["designation"] && !/^\d+$/.test(a["designation"]) ? a["designation"] : (a["id_localId"] ?? "").replace("FD.PS.", "") },
        effect: { type: "info" },
        provenance: prov("DLS INSPIRE Protected Sites (Forest Department)", `${DLS_INSPIRE}/PS_ProtectedSites/MapServer/1`),
      };
    });
  },
};

// ---------- Flood zones (DLS INSPIRE NZ: 20 / 100 / 500-year floodplains) ----------
const NZ_WMS = `${DLS_INSPIRE}/NZ_NaturalRiskZones/MapServer/exts/InspireView/service`;
const FLOOD_LAYERS = { "NZ.RiskZone_Floodplain_20": 20, "NZ.RiskZone_Floodplain_100": 100, "NZ.RiskZone_Floodplain_500": 500 } as const;

export function parseRawFeatureInfo(xml: string): { layer: string; fields: Record<string, string> }[] {
  const out: { layer: string; fields: Record<string, string> }[] = [];
  for (const col of xml.matchAll(/<esri_wms:FeatureInfoCollection layername="([^"]+)">([\s\S]*?)<\/esri_wms:FeatureInfoCollection>/g)) {
    for (const fi of col[2]!.matchAll(/<esri_wms:FeatureInfo>([\s\S]*?)<\/esri_wms:FeatureInfo>/g)) {
      const fields: Record<string, string> = {};
      for (const f of fi[1]!.matchAll(/<esri_wms:FieldName><!\[CDATA\[([^\]]*)\]\]><\/esri_wms:FieldName><esri_wms:FieldValue><!\[CDATA\[([^\]]*)\]\]>/g)) fields[f[1]!] = f[2]!;
      out.push({ layer: col[1]!, fields });
    }
  }
  return out;
}

async function floodAt(ctx: ProviderContext, p: LngLat) {
  const d = 0.0005, q = Object.keys(FLOOD_LAYERS).join(",");
  const bb = [p.lat - d, p.lng - d, p.lat + d, p.lng + d].map((v) => v.toFixed(7)).join(",");
  const url = `${NZ_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${q}&QUERY_LAYERS=${q}&CRS=EPSG:4326&BBOX=${bb}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=application/vnd.esri.wms_raw_xml&STYLES=&FEATURE_COUNT=10`;
  return parseRawFeatureInfo(await dlsGet(ctx, url));
}

export const floodZones: RestrictionLayer = {
  id: "flood",
  kind: "flood",
  enabled: true,
  async check(ctx, parcel) {
    const pts = samplePoints(parcel);
    const results = (await Promise.all(pts.map((p) => floodAt(ctx, p).catch(() => [])))).flat();
    if (!results.length) return [];
    const worst = Math.min(...results.map((r) => FLOOD_LAYERS[r.layer as keyof typeof FLOOD_LAYERS] ?? 999));
    const name = results.find((r) => FLOOD_LAYERS[r.layer as keyof typeof FLOOD_LAYERS] === worst)?.fields["Name"] ?? "";
    return [{
      layerId: "flood",
      kind: "flood",
      severity: worst <= 20 ? "critical" : worst <= 100 ? "warning" : "info",
      messageKey: "cy.restrict.flood",
      params: { years: worst, river: name },
      effect: { type: "info" },
      provenance: prov("DLS INSPIRE Natural Risk Zones — floodplains (Water Development Dept. flood maps)", `${NZ_WMS}?SERVICE=WMS&REQUEST=GetCapabilities`),
    }];
  },
};

// ---------- Coastline proximity (DLS INSPIRE SR shoreline, raster check) ----------
const SR_WMS = `${DLS_INSPIRE}/SR_SeaRegions/MapServer/exts/InspireView/service`;
const COAST_M = 100;

/** Distance (m) from the plot to the nearest shoreline pixel within COAST_M+50 m, or undefined. */
export async function distanceToCoast(ctx: ProviderContext, parcel: Parcel): Promise<number | undefined> {
  const b = bbox(parcel);
  const lat0 = (b.s + b.n) / 2;
  const pad = COAST_M + 50;
  const dLat = pad / 110_574, dLng = pad / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  const box = { w: b.w - dLng, s: b.s - dLat, e: b.e + dLng, n: b.n + dLat };
  const [x0, y0] = toXY(box.w, box.s, lat0), [x1, y1] = toXY(box.e, box.n, lat0);
  const W = Math.min(512, Math.max(64, Math.round(x1 - x0))), H = Math.min(512, Math.max(64, Math.round(y1 - y0)));
  const layers = "SR.Shoreline_NaturalCoastline,SR.Shoreline_ArtificialCoastline";
  const url = `${SR_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layers}&STYLES=&CRS=EPSG:4326&BBOX=${box.s},${box.w},${box.n},${box.e}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=true`;
  const res = await ctx.fetch(url);
  if (!res.ok) throw new Error(`coast WMS ${res.status}`);
  const img = decode(new Uint8Array(await res.arrayBuffer()));
  const ch = img.channels;
  const ring = outerRing(parcel).map(([lng, lat]) => toXY(lng!, lat!, lat0));
  const mx = (x1 - x0) / img.width, my = (y1 - y0) / img.height;
  let best = Infinity;
  for (let j = 0; j < img.height; j++) {
    for (let i = 0; i < img.width; i++) {
      const a = ch === 4 ? img.data[(j * img.width + i) * 4 + 3]! : 255;
      if (a < 64) continue;
      const p: [number, number] = [x0 + (i + 0.5) * mx, y1 - (j + 0.5) * my];
      for (let k = 1; k < ring.length; k++) {
        const A = ring[k - 1]!, B = ring[k]!;
        const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / l2));
        best = Math.min(best, Math.hypot(p[0] - A[0] - t * dx, p[1] - A[1] - t * dy));
      }
    }
  }
  return best === Infinity ? undefined : Math.round(best);
}

export const coastalZone: RestrictionLayer = {
  id: "coast",
  kind: "coastal",
  enabled: true,
  async check(ctx, parcel) {
    const d = await distanceToCoast(ctx, parcel);
    if (d === undefined || d > COAST_M) return [];
    return [{
      layerId: "coast",
      kind: "coastal",
      severity: "warning",
      messageKey: "cy.restrict.coast",
      params: { distance: d },
      effect: { type: "info" },
      provenance: prov("DLS INSPIRE shoreline; Foreshore Protection Law (Cap. 59); Larnaca LP Appendix 3 'Ζώνη Προστασίας της Παραλίας'", `${SR_WMS}?SERVICE=WMS&REQUEST=GetCapabilities`),
    }];
  },
};

// ---------- Larnaca International Airport (LCLK) ----------
// Runway 04/22 ends from OpenStreetMap (aeroway=runway); aerodrome elevation 8 ft (2.4 m) per the AIP.
// Obstacle limitation surfaces: ICAO Annex 14 Vol. I, Table 4-1, code 4 precision approach runway.
// Public Safety Zones: Larnaca Local Plan 2019 §32.4.1 (triangles 100×600 m and 350×3,500 m).
const LCLK = { a: [33.6123252, 34.8642202] as const, b: [33.6359259, 34.8835657] as const, elevM: 2.4 };
const LP = "https://eoal.org.cy/wp-content/uploads/2024/07/Top_sx_3.pdf";

interface RunwayFrame { u: number; v: number; L: number }
function runwayFrame(lng: number, lat: number): RunwayFrame {
  const lat0 = LCLK.a[1];
  const A = toXY(LCLK.a[0], LCLK.a[1], lat0), B = toXY(LCLK.b[0], LCLK.b[1], lat0), P = toXY(lng, lat, lat0);
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  const dx = P[0] - A[0], dy = P[1] - A[1];
  return { u: dx * ux + dy * uy, v: -dx * uy + dy * ux, L };
}

/** Lowest obstacle limitation surface above a point, in metres above the aerodrome elevation. */
export function olsHeightAboveAerodrome(lng: number, lat: number): { height: number; surface: string } | undefined {
  const { u, v, L } = runwayFrame(lng, lat);
  const s0 = -60, s1 = L + 60; // runway strip ends
  const uc = Math.max(s0, Math.min(s1, u));
  const dStrip = Math.hypot(u - uc, v); // distance to the strip centreline segment
  const cands: { height: number; surface: string }[] = [];
  if (dStrip <= 4000) cands.push({ height: 45, surface: "inner_horizontal" });
  else if (dStrip <= 6000) cands.push({ height: 45 + 0.05 * (dStrip - 4000), surface: "conical" });
  for (const s of [s0 - u, u - s1]) {
    // approach surfaces beyond each strip end
    if (s < 0 || s > 15000) continue;
    if (Math.abs(v) > 150 + 0.15 * s) continue;
    const h = s <= 3000 ? 0.02 * s : s <= 6600 ? 60 + 0.025 * (s - 3000) : 150;
    cands.push({ height: Math.min(h, 150), surface: "approach" });
  }
  if (u >= s0 && u <= s1 && Math.abs(v) > 150) {
    const h = 0.143 * (Math.abs(v) - 150);
    if (h < 45) cands.push({ height: h, surface: "transitional" });
  }
  return cands.length ? cands.reduce((m, c) => (c.height < m.height ? c : m)) : undefined;
}

/** Point lies in a PSZ triangle: base `w` at the runway end, apex `len` out along the extended centreline. */
function inPsz(lng: number, lat: number, w: number, len: number): boolean {
  const { u, v, L } = runwayFrame(lng, lat);
  for (const s of [-u, u - L]) {
    if (s >= 0 && s <= len && Math.abs(v) <= (w / 2) * (1 - s / len)) return true;
  }
  return false;
}

export const larnacaAirport: RestrictionLayer = {
  id: "airport",
  kind: "airport_height",
  enabled: true,
  async check(ctx, parcel) {
    const pts = samplePoints(parcel, 5);
    const ring = outerRing(parcel);
    const all = [...pts, ...ring.map(([lng, lat]) => ({ lng: lng!, lat: lat! }))];
    const hits: RestrictionHit[] = [];
    if (all.some((p) => inPsz(p.lng, p.lat, 100, 600))) {
      hits.push({ layerId: "airport:psz1", kind: "airport_height", severity: "critical", messageKey: "cy.restrict.psz1",
        effect: { type: "block", reason: "Public Safety Zone 100×600 m" }, provenance: prov("Larnaca Local Plan 2019 §32.4.1(α) — zone geometry approximated from the stated dimensions", LP, "§32.4.1") });
    } else if (all.some((p) => inPsz(p.lng, p.lat, 350, 3500))) {
      hits.push({ layerId: "airport:psz2", kind: "airport_height", severity: "critical", messageKey: "cy.restrict.psz2",
        effect: { type: "block", reason: "Public Safety Zone 350×3,500 m" }, provenance: prov("Larnaca Local Plan 2019 §32.4.1(β) — zone geometry approximated from the stated dimensions", LP, "§32.4.1") });
    }
    const ols = all.map((p) => ({ p, s: olsHeightAboveAerodrome(p.lng, p.lat) })).filter((x) => x.s !== undefined) as { p: LngLat; s: { height: number; surface: string } }[];
    if (ols.length) {
      const low = ols.reduce((m, c) => (c.s.height < m.s.height ? c : m));
      const altitude = Math.round((LCLK.elevM + low.s.height) * 10) / 10;
      // Allowed building height at each point = surface altitude − ground there (DLS terrain model);
      // the plot's limit is the lowest of these.
      // ground is sampled at the same ≤17 points as the plot's elevation (shared cache), not every vertex
      const gpts = elevationPoints(parcel).map((p) => ({ p, s: olsHeightAboveAerodrome(p.lng, p.lat) })).filter((x) => x.s !== undefined) as typeof ols;
      const grounds = await Promise.all(gpts.map((x) => groundElevation(ctx, x.p).catch(() => undefined)));
      const caps = gpts.map((x, i) => (grounds[i] ? { cap: LCLK.elevM + x.s.height - grounds[i]!.elevationM, ground: grounds[i]!.elevationM, src: grounds[i]!.source } : undefined)).filter((c) => c !== undefined);
      // conservative: also the lowest surface anywhere on the plot over its highest sampled ground
      const highest = caps.length ? caps.reduce((m, c) => (c.ground > m.ground ? c : m)) : undefined;
      if (highest) caps.push({ ...highest, cap: altitude - highest.ground });
      const worst = caps.length ? caps.reduce((m, c) => (c.cap < m.cap ? c : m)) : undefined;
      const maxHeight = worst ? Math.max(0, Math.floor(worst.cap * 10) / 10) : undefined;
      hits.push({
        layerId: "airport:ols",
        kind: "airport_height",
        severity: "warning",
        messageKey: maxHeight !== undefined ? "cy.restrict.olsHeight" : "cy.restrict.olsAltitude",
        params: { altitude, surface: low.s.surface, ...(worst ? { height: maxHeight!, ground: Math.round(worst.ground * 10) / 10 } : {}) },
        effect: maxHeight !== undefined ? { type: "cap_height", maxHeightM: maxHeight } : { type: "info" },
        provenance: prov(
          `ICAO Annex 14 obstacle limitation surfaces (code 4 precision runway), LCLK runway 04/22 — indicative; Department of Civil Aviation consent required${worst ? `. Ground: DLS ${worst.src}` : ""}`,
          "https://www.icao.int/safety/airnavigation/nationalitycodes/pages/annex14.aspx",
        ),
      });
    }
    return hits;
  },
};

/** Zone-coded airport noise provisions (Larnaca LP §32.4.2, §32.5): Lnight 60 dB(A) contour. */
const NOISE_ZONES: Record<string, string> = {
  "Γρ1": "cy.restrict.noiseGr1",
  "Εβ7γ": "cy.restrict.noiseEb7g",
  "ΕΔΑ1α": "cy.restrict.noiseEda1a",
  "Τ3β(Ε)": "cy.restrict.noiseT3b",
};
export function larnacaNoiseFor(zoneCode: string, planRef?: string): RestrictionHit | undefined {
  const key = NOISE_ZONES[zoneCode.trim()];
  if (!key || planRef !== "401") return undefined;
  return { layerId: "airport:noise", kind: "airport_height", severity: "warning", messageKey: key, effect: zoneCode.trim() === "Γρ1" ? { type: "cap_floors", maxFloors: 2 } : { type: "info" },
    provenance: prov("Larnaca Local Plan 2019 §32.4.2, §32.5 — Lnight 60 dB(A) noise contour (Plan No. 8)", LP, "§32.5") };
}

export const cyRestrictionLayers: RestrictionLayer[] = [larnacaAirport, floodZones, natura2000, forestSites, coastalZone];
