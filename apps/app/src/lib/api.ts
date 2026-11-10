import type { NationalGrid, Parcel, SiteContext, ZoneHit, ZoneRuleSet, UseType } from "@plotcheck/core";
import type { AnalysisParams, AnalysisResult, FinanceParams } from "@plotcheck/engine";
import { supabase } from "./supabase";

/** Supabase Edge Function URL in production, local dev server otherwise. Never holds secrets. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

export type MapLayerGroup = "basemap" | "cadastre" | "terrain" | "planning" | "risk" | "water" | "environment" | "infrastructure" | "admin" | "statistics";
interface MapLayerBase { id: string; titleKey: string; group: MapLayerGroup; attributionKey: string; minzoom?: number; maxzoom?: number; opacity?: number; defaultOn?: boolean; date?: string; role: "basemap" | "overlay"; choices?: LayerChoices; legend?: boolean; info?: boolean }
export interface LayerChoices {
  dims: { key: string; titleKey: string; options: { id: string; titleKey: string; minzoom?: number }[] }[];
  layers: Record<string, string>;
  initial: string[];
}
export interface AreaInfoRow { key: string; value: number; kind?: "count" | "percent" | "decimal" | "perKm2"; of?: number }
export interface AreaInfo { areas: { levelKey: string; name: { el?: string; en?: string }; sections: { titleKey: string; rows: AreaInfoRow[] }[] }[]; sourceKey: string }
export interface LegendItem { label: string; image: string }
export type MapLayerDef =
  | (MapLayerBase & { kind: "xyz"; url: string })
  | (MapLayerBase & { kind: "wms"; url: string; layers: string })
  | (MapLayerBase & { kind: "arcgis"; url: string; layers?: string })
  | (MapLayerBase & { kind: "contours" });

export interface StreetHit {
  name: string;
  part?: { n: number; of: number };
  postcodes: string[];
  center: { lng: number; lat: number };
  bbox: [number, number, number, number];
}

export interface CountryConfig {
  code: string;
  nameKey: string;
  locales: string[];
  currency: string;
  bbox: [number, number, number, number];
  defaultView: { center: { lng: number; lat: number }; zoom: number };
  mapLayers: MapLayerDef[];
  nationalGrid?: NationalGrid;
  messages: Record<string, Record<string, string>>;
  legal: { disclaimerKey: string; attributionKeys: string[] };
  coverage: { dist_abbr: string; planName: string; status: string }[];
  defaults: AnalysisParams;
}

export interface ParcelsResponse {
  country: string;
  providerId: string;
  parcels: Parcel[];
}

export interface PlotSearchIndex {
  region: string;
  source: string;
  municipalities: {
    code: string;
    el?: string | null;
    en?: string | null;
    quarters: { code: string; el?: string | null; en?: string | null }[];
    sheets: Record<string, Record<string, number>>;
  }[];
}

export interface RestrictionHit {
  layerId: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  messageKey: string;
  params?: Record<string, string | number>;
  effect: { type: string };
  provenance: { source: string; sourceRef?: string };
}

export interface ZonesResponse {
  parcel: Parcel;
  zones: ZoneHit[];
  site?: SiteContext;
  restrictions: RestrictionHit[];
  primary?: { zone: ZoneHit; rules: ZoneRuleSet; coverage: "curated" | "source_only"; mismatches: Mismatch[] };
}

export interface Mismatch {
  constraint: string;
  curated: number;
  published: number;
}

export interface AnalyseResponse {
  parcel: Parcel;
  zone: ZoneHit;
  otherZones: ZoneHit[];
  coverage: "curated" | "source_only";
  mismatches: Mismatch[];
  site?: SiteContext;
  rules: ZoneRuleSet;
  params: AnalysisParams;
  results: (AnalysisResult & { relaxedPreview?: RelaxedPreview })[];
  finance?: FinanceDefaults;
  disclaimerKey: string;
  /** full = paid parts included (relaxations in detail, finance); billing = paid access is in force. */
  access?: { full: boolean; signedIn: boolean; billing: boolean };
}

export interface RelaxedPreview { gfaM2: number; floors: number; units?: number; gainM2: number }

export interface Plan {
  id: string;
  kind: "subscription" | "report";
  name: Record<string, string>;
  description: Record<string, string>;
  price_cents: number;
  currency: string;
  interval: "month" | "year" | null;
}

export interface AccessInfo {
  enabled: boolean;
  signedIn: boolean;
  full: boolean;
  unlocked: boolean;
  subscription?: { plan_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean };
}

export interface MarketStats {
  area: string;
  from: string;
  to: string;
  sales: number;
  plots: number;
  totalValue: number;
  avgValuePerSale: number;
  changeVsYearBefore?: number;
  salesYearBefore?: number;
  monthly: { month: string; sales: number; avgValue: number }[];
  source: { label: string; url: string };
}

export interface FinanceDefaults {
  byUse: Record<UseType, FinanceParams>;
  finishFactor: Record<"basic" | "standard" | "high", number>;
  officialLandValue?: { perM2Buildable: number; perM2BuildableGround: number; far: number; total: number; areaKey: string; date: string; source: { label: string; url: string } };
  sources: { label: string; url: string }[];
  notes: string[];
  market?: MarketStats;
}

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

async function call<T>(path: string, init?: { body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  // signed-in users send their access token: the API returns the paid parts they are entitled to
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  const headers: Record<string, string> = { ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.body === undefined ? "GET" : "POST",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init?.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("network", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "generic", res.status);
  return data;
}

export const api = {
  countries: () => call<{ countries: CountryConfig[] }>("/v1/countries"),
  plans: () => call<{ enabled: boolean; providers: { stripe: boolean; jcc: boolean }; plans: Plan[] }>("/v1/billing/plans"),
  access: (country?: string, ref?: string) => call<AccessInfo>(`/v1/me/access${country && ref ? `?country=${encodeURIComponent(country)}&ref=${encodeURIComponent(ref)}` : ""}`),
  checkout: (plan: string, provider: "stripe" | "jcc", country?: string, nationalRef?: string) =>
    call<{ url: string }>("/v1/billing/checkout", { body: { plan, provider, ...(country ? { country } : {}), ...(nationalRef ? { nationalRef } : {}) } }),
  portal: () => call<{ url: string }>("/v1/billing/portal", { body: {} }),
  parcelsAtPoint: (lng: number, lat: number, signal?: AbortSignal) =>
    call<ParcelsResponse>("/v1/parcels/at-point", { body: { lng, lat }, signal }),
  areaInfo: (country: string, layer: string, lng: number, lat: number) =>
    call<AreaInfo>(`/v1/area-info?country=${encodeURIComponent(country)}&layer=${encodeURIComponent(layer)}&lng=${lng.toFixed(6)}&lat=${lat.toFixed(6)}`),
  mapLegend: (country: string, layer: string, layers: string) =>
    call<{ items: LegendItem[] }>(`/v1/map-legend?country=${encodeURIComponent(country)}&layer=${encodeURIComponent(layer)}&layers=${encodeURIComponent(layers)}`),
  googleTiles: (lang: string) => call<{ available: boolean; tiles?: Partial<Record<"roadmap" | "satellite" | "hybrid", string>> }>(`/v1/maps/google?lang=${lang === "en" ? "en" : "el"}`),
  plotIndex: (country: string, region: string) => call<PlotSearchIndex>(`/v1/plot-index?country=${encodeURIComponent(country)}&region=${encodeURIComponent(region)}`),
  parcelsById: (country: string, identifiers: Record<string, string>, signal?: AbortSignal) =>
    call<{ country: string; parcels: Parcel[] }>("/v1/parcels/by-id", { body: { country, identifiers }, signal }),
  parcelsInBox: (country: string, plot: string, bbox: [number, number, number, number], signal?: AbortSignal) =>
    call<{ country: string; parcels: Parcel[] }>("/v1/parcels/in-box", { body: { country, plot, bbox }, signal }),
  parcelsSearch: (country: string, identifiers: Record<string, string>, signal?: AbortSignal) =>
    call<{ country: string; parcels: Parcel[] }>("/v1/parcels/search", { body: { country, identifiers }, signal }),
  contours: (country: string, bbox: [number, number, number, number], signal?: AbortSignal) =>
    call<GeoJSON.FeatureCollection & { interval?: number }>(`/v1/contours?country=${encodeURIComponent(country)}&bbox=${bbox.map((x) => x.toFixed(5)).join(",")}`, { signal }),
  streets: (country: string, q: string, signal?: AbortSignal) =>
    call<{ country: string; streets: StreetHit[] }>(`/v1/streets?country=${encodeURIComponent(country)}&q=${encodeURIComponent(q)}`, { signal }),
  zones: (country: string, nationalRef: string, signal?: AbortSignal) =>
    call<ZonesResponse>("/v1/zones", { body: { country, nationalRef }, signal }),
  analyse: (country: string, nationalRef: string, use: UseType | "all", params?: Partial<AnalysisParams>, signal?: AbortSignal) =>
    call<AnalyseResponse>("/v1/analyse", { body: { country, nationalRef, use, params }, signal }),
};
