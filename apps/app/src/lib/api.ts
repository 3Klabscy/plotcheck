import type { Parcel, SiteContext, ZoneHit, ZoneRuleSet, UseType } from "@plotcheck/core";
import type { AnalysisParams, AnalysisResult, FinanceParams } from "@plotcheck/engine";

/** Supabase Edge Function URL in production, local dev server otherwise. Never holds secrets. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

export type MapLayerDef =
  | { id: string; kind: "xyz"; url: string; attributionKey: string; maxzoom?: number; role: "basemap" }
  | { id: string; kind: "wms"; url: string; layers: string; attributionKey: string; role: "overlay"; minzoom?: number; opacity?: number };

export interface CountryConfig {
  code: string;
  nameKey: string;
  locales: string[];
  currency: string;
  bbox: [number, number, number, number];
  defaultView: { center: { lng: number; lat: number }; zoom: number };
  mapLayers: MapLayerDef[];
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
  results: AnalysisResult[];
  finance?: FinanceDefaults;
  disclaimerKey: string;
}

export interface FinanceDefaults {
  byUse: Record<UseType, FinanceParams>;
  finishFactor: Record<"basic" | "standard" | "high", number>;
  officialLandValue?: { perM2Buildable: number; perM2BuildableGround: number; far: number; total: number; areaKey: string; date: string; source: { label: string; url: string } };
  sources: { label: string; url: string }[];
  notes: string[];
}

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

async function call<T>(path: string, init?: { body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.body === undefined ? "GET" : "POST",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
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
  parcelsAtPoint: (lng: number, lat: number, signal?: AbortSignal) =>
    call<ParcelsResponse>("/v1/parcels/at-point", { body: { lng, lat }, signal }),
  plotIndex: (country: string, region: string) => call<PlotSearchIndex>(`/v1/plot-index?country=${encodeURIComponent(country)}&region=${encodeURIComponent(region)}`),
  parcelsById: (country: string, identifiers: Record<string, string>, signal?: AbortSignal) =>
    call<{ country: string; parcels: Parcel[] }>("/v1/parcels/by-id", { body: { country, identifiers }, signal }),
  zones: (country: string, nationalRef: string, signal?: AbortSignal) =>
    call<ZonesResponse>("/v1/zones", { body: { country, nationalRef }, signal }),
  analyse: (country: string, nationalRef: string, use: UseType | "all", params?: Partial<AnalysisParams>, signal?: AbortSignal) =>
    call<AnalyseResponse>("/v1/analyse", { body: { country, nationalRef, use, params }, signal }),
};
