import type {
  Relaxation,
  CurrencyCode,
  LngLat,
  Parcel,
  PlotIdentifier,
  PolygonGeometry,
  Provenance,
  RuleLayer,
  UseType,
  ZoneHit,
} from "@plotcheck/core";

/** Network access is injected so modules run unchanged in Deno, Node and tests. */
export interface ProviderContext {
  fetch: typeof fetch;
  /** Secrets from the server environment only. Never available in the client app. */
  env: (name: string) => string | undefined;
  signal?: AbortSignal;
  now?: () => Date;
}

export interface ParcelProvider {
  id: string;
  name: string;
  /** Disabled providers (e.g. no licence yet) are skipped by the registry. */
  enabled: boolean;
  /** Parcels at/near a WGS84 point. The first result contains the point when one does. */
  getByPoint(ctx: ProviderContext, point: LngLat, opts?: { radiusM?: number }): Promise<Parcel[]>;
  getById(ctx: ProviderContext, id: PlotIdentifier): Promise<Parcel | null>;
}

export interface PlanningProvider {
  id: string;
  name: string;
  enabled: boolean;
  /** Zones covering the parcel, with an approximate share each (a parcel can straddle zones). */
  zonesFor(ctx: ProviderContext, parcel: Parcel): Promise<ZoneHit[]>;
}

export type RestrictionKind =
  | "road_widening"
  | "airport_height"
  | "coastal"
  | "flood"
  | "natura2000"
  | "protected_site"
  | "archaeology"
  | "listed_building"
  | "no_road_access"
  | "other";

export type RestrictionEffect =
  | { type: "reduce_net_area"; areaM2: number }
  | { type: "cap_height"; maxHeightM: number }
  | { type: "cap_floors"; maxFloors: number }
  | { type: "block"; reason: string }
  | { type: "info" };

export interface RestrictionHit {
  layerId: string;
  kind: RestrictionKind;
  severity: "info" | "warning" | "critical";
  /** i18n key + params, rendered by the client in the user's language. */
  messageKey: string;
  params?: Record<string, string | number>;
  effect: RestrictionEffect;
  provenance: Provenance;
}

/** Phase 2. Declared now so modules can fill it in without interface changes. */
export interface RestrictionLayer {
  id: string;
  kind: RestrictionKind;
  enabled: boolean;
  check(ctx: ProviderContext, parcel: Parcel): Promise<RestrictionHit[]>;
}

export interface PlotIdField {
  key: string;
  labelKey: string; // i18n key
  required: boolean;
  /** Cascading dropdown: options depend on the values of these fields. */
  dependsOn?: string[];
  kind: "select" | "text";
}

export interface PlotIdSchema {
  fields: PlotIdField[];
  /** Turn a provider's national reference into the form fields (and back). */
  parseNationalRef?(ref: string): PlotIdentifier | null;
}

export interface DocScanSchema {
  /** JSON schema handed to the vision model (phase 2). MUST contain plot-identification fields only. */
  jsonSchema: Record<string, unknown>;
  /** Field names that must never be extracted, stored or logged (personal data). */
  forbiddenFields: string[];
}

export interface CountryDefaults {
  /** Default storey height used to check floors against max height (m). */
  storeyHeightM: number;
  /** Gross-to-net ratio for apartment blocks (circulation, walls, core). */
  netToGrossResidential: number;
  avgUnitSizeM2: { studio: number; bed1: number; bed2: number; bed3: number };
  avgHouseSizeM2: number;
  minRowHouseWidthM: number;
}

export interface LegalTexts {
  /** i18n key for the result disclaimer. */
  disclaimerKey: string;
  attributionKeys: string[];
}

export type FeatureFlag = "docScan" | "plotIdSearch" | "restrictions" | "financials" | "brokering" | "ads";

export interface CountryModule {
  code: string; // ISO 3166-1 alpha-2
  nameKey: string;
  locales: string[]; // first = default
  currency: CurrencyCode;
  /** Rough bounding box [west, south, east, north] used for auto-detection and map start. */
  bbox: [number, number, number, number];
  defaultView: { center: LngLat; zoom: number };
  parcelProviders: ParcelProvider[];
  planningProviders: PlanningProvider[];
  restrictionLayers: RestrictionLayer[];
  plotIdSchema: PlotIdSchema;
  docScanSchema?: DocScanSchema;
  /** Built-in rule layers (country defaults, seeded zones). The DB adds/overrides at runtime. */
  ruleLayers: RuleLayer[];
  /** Map published zone codes to permitted uses where the country has a naming convention. */
  usesForZone?(zone: ZoneHit): { value: UseType[] | null; conditional: UseType[]; provenance: Provenance };
  /** Planning relaxations/incentives that may apply to a plot in this zone (island-wide + area). */
  relaxationsFor?(zone: ZoneHit, ctx: { baseFar?: number; parcel?: Parcel }): Relaxation[];
  /** Turn a published zone hit into a "source" rule layer (coefficients the source publishes). */
  sourceLayerForZone?(zone: ZoneHit): RuleLayer;
  /** Coverage of curated rules shipped with this module (for the admin coverage map later). */
  coverage: { dist_abbr: string; planName: string; status: "curated" | "source_only" }[];
  defaults: CountryDefaults;
  legal: LegalTexts;
  features: Partial<Record<FeatureFlag, boolean>>;
  /** Map basemaps / overlays offered to the client (all public, CORS-enabled sources). */
  mapLayers: MapLayerDef[];
  /** Country-specific UI strings per locale (field labels, attributions, legal texts). */
  messages: Record<string, Record<string, string>>;
}

export type MapLayerDef =
  | { id: string; kind: "xyz"; url: string; attributionKey: string; maxzoom?: number; role: "basemap" }
  | { id: string; kind: "wms"; url: string; layers: string; attributionKey: string; role: "overlay"; minzoom?: number; opacity?: number };

// ---------- Registry ----------

const modules = new Map<string, CountryModule>();

export function registerCountry(m: CountryModule): void {
  modules.set(m.code, m);
}

export function getCountry(code: string): CountryModule {
  const m = modules.get(code.toUpperCase());
  if (!m) throw new CountryNotSupportedError(code);
  return m;
}

export function listCountries(): CountryModule[] {
  return [...modules.values()];
}

export function countryForPoint(p: LngLat): CountryModule | undefined {
  return listCountries().find(({ bbox: [w, s, e, n] }) => p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n);
}

export class CountryNotSupportedError extends Error {
  constructor(public code: string) {
    super(`Country not supported: ${code}`);
  }
}

/** Try each enabled provider in order; fall back to the next on error or empty result. */
export async function withFallback<P extends { id: string; enabled: boolean }, R>(
  providers: P[],
  call: (p: P) => Promise<R>,
  isEmpty: (r: R) => boolean,
): Promise<{ result: R; providerId: string; errors: { providerId: string; error: string }[] }> {
  const errors: { providerId: string; error: string }[] = [];
  let last: { result: R; providerId: string } | undefined;
  for (const p of providers.filter((x) => x.enabled)) {
    try {
      const result = await call(p);
      last = { result, providerId: p.id };
      if (!isEmpty(result)) return { ...last, errors };
    } catch (e) {
      errors.push({ providerId: p.id, error: (e as Error).message });
    }
  }
  if (last) return { ...last, errors };
  throw new AllProvidersFailedError(errors);
}

export class AllProvidersFailedError extends Error {
  constructor(public errors: { providerId: string; error: string }[]) {
    super(`All providers failed: ${errors.map((e) => `${e.providerId}: ${e.error}`).join("; ") || "none enabled"}`);
  }
}

export type { PolygonGeometry };
