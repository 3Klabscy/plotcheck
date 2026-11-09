import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import pointOnFeature from "@turf/point-on-feature";
import type { Feature } from "geojson";
import type { ConstraintName, LngLat, Parcel, ZoneHit } from "@plotcheck/core";
import type { PlanningProvider, ProviderContext } from "@plotcheck/country-sdk";
import { parseFeatureInfo } from "./gml.ts";
import { DLS_INSPIRE, dlsGet } from "./http.ts";

const WMS = `${DLS_INSPIRE}/LU_LandUse/MapServer/exts/InspireView/service`;
export const PLANNING_ZONE_LAYER = "LU.ExistingLandUse_plnz";

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === "" || v === "Null") return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: string | undefined) => (v === undefined || v === "" || v === "Null" ? undefined : v);

/** Esri date "9/13/2022 6:20:05 AM" → ISO date. */
function esriDate(v: string | undefined): string | undefined {
  const m = v && /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : undefined;
}

export interface DlsZoneAttributes {
  zoneCode: string;
  description?: string;
  coverage?: number;
  density?: number;
  heightM?: number;
  stories?: number;
  planName?: string;
  planRef?: string;
  districtCode?: string;
  lastEdited?: string;
  remarks?: string;
}

export function mapZoneAttributes(a: Record<string, string>): DlsZoneAttributes | null {
  const zoneCode = str(a["PlanningZoneName"]);
  if (!zoneCode) return null;
  return {
    zoneCode,
    description: str(a["PlanningZoneDescription"]),
    coverage: num(a["Coverage"]),
    density: num(a["Density"]),
    heightM: num(a["Height"]),
    stories: num(a["AllowedStories"]),
    planName: str(a["DevelopmentPlanDescription"]),
    planRef: str(a["DevelopmentPlanCompositeCode"]),
    districtCode: str(a["DistrictCode"])?.split(" ")[0],
    lastEdited: esriDate(a["LastEditedDate"]),
    remarks: str(a["Remarks"]),
  };
}

/** Query the DLS planning-zone layer at one WGS84 point (WMS 1.3.0, EPSG:4326 = lat,lon). */
export async function zoneAtPoint(ctx: ProviderContext, p: LngLat): Promise<DlsZoneAttributes | null> {
  const d = 0.0005;
  const bboxParam = [p.lat - d, p.lng - d, p.lat + d, p.lng + d].map((v) => v.toFixed(7)).join(",");
  const url =
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${PLANNING_ZONE_LAYER}&QUERY_LAYERS=${PLANNING_ZONE_LAYER}` +
    `&CRS=EPSG:4326&BBOX=${bboxParam}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/xml&STYLES=`;
  const xml = await dlsGet(ctx, url);
  const first = parseFeatureInfo(xml)[0];
  return first ? mapZoneAttributes(first) : null;
}

/** Interior sample points: point-on-surface plus the centres of the bbox quadrants that fall inside. */
export function samplePoints(parcel: Parcel, max = 5): LngLat[] {
  const f = { type: "Feature", properties: {}, geometry: parcel.geometry } as Feature;
  const pos = pointOnFeature(f).geometry.coordinates as [number, number];
  const pts: LngLat[] = [{ lng: pos[0], lat: pos[1] }];
  const [w, s, e, n] = bbox(f);
  for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
    const c: [number, number] = [w + (e - w) * fx, s + (n - s) * fy];
    if (pts.length < max && booleanPointInPolygon(c, parcel.geometry)) pts.push({ lng: c[0], lat: c[1] });
  }
  return pts;
}

export function toZoneHit(z: DlsZoneAttributes, parcel: Parcel, share: number, fetchedAt: string): ZoneHit {
  const published: Partial<Record<ConstraintName, number>> = {};
  if (z.density !== undefined) published.far = z.density;
  if (z.coverage !== undefined) published.lot_cov_bldg = z.coverage;
  if (z.stories !== undefined) published.stories = z.stories;
  if (z.heightM !== undefined) published.height = z.heightM;
  const municipality = parcel.identifiers["municipalityCode"];
  const district = z.districtCode ?? municipality?.slice(0, 1);
  return {
    zoneCode: z.zoneCode,
    description: z.description,
    planName: z.planName,
    planRef: z.planRef,
    jurisdiction: { path: ["CY", ...(district ? [district] : []), ...(municipality ? [municipality] : [])] },
    share,
    publishedConstraints: published,
    provenance: {
      source: "DLS INSPIRE Land Use — planning zones (LU.ExistingLandUse_plnz)",
      sourceRef: `${WMS}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`,
      fetchedAt,
      sourceUpdatedAt: z.lastEdited,
      // Published coefficients are source data, not a verified reading of the Local Plan.
      status: "needs_review",
    },
  };
}

export const dlsPlanningZones: PlanningProvider = {
  id: "cy.dls.inspire.lu",
  name: "Department of Lands and Surveys — INSPIRE planning zones",
  enabled: true,
  async zonesFor(ctx: ProviderContext, parcel: Parcel): Promise<ZoneHit[]> {
    const pts = samplePoints(parcel);
    const results = await Promise.all(pts.map((p) => zoneAtPoint(ctx, p).catch(() => undefined)));
    const ok = results.filter((r): r is DlsZoneAttributes | null => r !== undefined);
    if (ok.length === 0) throw new Error("DLS planning-zone service did not answer");
    const fetchedAt = (ctx.now?.() ?? new Date()).toISOString();
    const counts = new Map<string, { z: DlsZoneAttributes; n: number }>();
    for (const z of ok) {
      if (!z) continue;
      const key = `${z.planRef ?? ""}|${z.zoneCode}`;
      const e = counts.get(key);
      if (e) e.n++;
      else counts.set(key, { z, n: 1 });
    }
    return [...counts.values()]
      .sort((a, b) => b.n - a.n)
      .map(({ z, n }) => toZoneHit(z, parcel, Math.round((n / ok.length) * 100) / 100, fetchedAt));
  },
};
