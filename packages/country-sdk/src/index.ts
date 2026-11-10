import type {
  Relaxation,
  SiteContext,
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
  /** Plots matching partial identifiers (e.g. municipality + plot number, as the cadastre's search does). */
  search?(ctx: ProviderContext, id: PlotIdentifier, opts?: { limit?: number }): Promise<Parcel[]>;
  /** Plots with this number inside a lat/lng box (the visible map). */
  findInBox?(ctx: ProviderContext, plot: string, bbox: [number, number, number, number]): Promise<Parcel[]>;
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
  /** Options for the cascading search form (per district/region), served to the client as JSON. */
  searchIndex?(region: string): Promise<PlotSearchIndex | undefined>;
  formatNationalRef?(id: PlotIdentifier): string | null;
  /** Turn a provider's national reference into the form fields (and back). */
  parseNationalRef?(ref: string): PlotIdentifier | null;
}

/** Generic cascading-search index: each level lists options; leaves carry plot counts. */
export interface PlotSearchIndex {
  region: string;
  source: string;
  municipalities: {
    code: string;
    el?: string | null;
    en?: string | null;
    quarters: { code: string; el?: string | null; en?: string | null }[];
    /** sheet/plan → "quarter-block" → number of plots */
    sheets: Record<string, Record<string, number>>;
  }[];
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

/** Property market of the plot's area from official statistics (activity and average value per sale). */
export interface MarketStats {
  area: string;
  /** First and last month with data, YYYY-MM. */
  from: string;
  to: string;
  sales: number;
  plots: number;
  totalValue: number;
  avgValuePerSale: number;
  /** Change of the average value per sale against the same months a year before (0.05 = +5%). */
  changeVsYearBefore?: number;
  salesYearBefore?: number;
  monthly: { month: string; sales: number; avgValue: number }[];
  source: { label: string; url: string };
}

export interface FinanceDefaults {
  /** Default financial parameters per building type (engine FinanceParams shape). */
  byUse: Record<UseType, import("@plotcheck/engine").FinanceParams>;
  finishFactor: Record<"basic" | "standard" | "high", number>;
  officialLandValue?: { perM2Buildable: number; perM2BuildableGround: number; far: number; total: number; areaKey: string; date: string; source: { label: string; url: string } };
  sources: { label: string; url: string }[];
  notes: string[];
  /** Market activity in the plot's area (official statistics), as context for the sale price. */
  market?: MarketStats;
}

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
  relaxationsFor?(zone: ZoneHit, ctx: { baseFar?: number; parcel?: Parcel; site?: SiteContext }): Relaxation[];
  /** Financial defaults for a plot (prices, costs, fees) and its official land value. */
  financeDefaults?(parcel: Parcel, zone: ZoneHit | undefined): FinanceDefaults;
  /** Restrictions that follow from the zone itself (e.g. airport noise zones). */
  restrictionsForZone?(zone: ZoneHit): RestrictionHit[];
  /** Road access, frontage and postcodes for a plot, where the country has the data. */
  siteContext?(ctx: ProviderContext, parcel: Parcel): Promise<SiteContext | undefined>;
  /** Turn a published zone hit into a "source" rule layer (coefficients the source publishes). */
  sourceLayerForZone?(zone: ZoneHit): RuleLayer;
  /** Coverage of curated rules shipped with this module (for the admin coverage map later). */
  coverage: { dist_abbr: string; planName: string; status: "curated" | "source_only" }[];
  defaults: CountryDefaults;
  legal: LegalTexts;
  features: Partial<Record<FeatureFlag, boolean>>;
  /** The national survey grid, for showing and importing coordinates (e.g. CGRS93 / LTM). */
  nationalGrid?: import("@plotcheck/core").NationalGrid;
  /** Contour lines (GeoJSON) over a small lat/lng box, for the map. */
  contours?(ctx: ProviderContext, bbox: [number, number, number, number]): Promise<unknown>;
  /** Streets by name (address search). */
  streetSearch?(query: string, opts?: { limit?: number }): StreetHit[];
  /** Map basemaps / overlays offered to the client (all public, CORS-enabled sources). */
  mapLayers: MapLayerDef[];
  /** Country-specific UI strings per locale (field labels, attributions, legal texts). */
  messages: Record<string, Record<string, string>>;
}

export type MapLayerGroup = "basemap" | "cadastre" | "terrain" | "planning" | "risk" | "water" | "environment" | "infrastructure" | "admin" | "statistics";

interface MapLayerBase {
  id: string;
  /** i18n key of the layer name shown in the layer panel. */
  titleKey: string;
  group: MapLayerGroup;
  attributionKey: string;
  minzoom?: number;
  maxzoom?: number;
  opacity?: number;
  /** Shown when the map opens. */
  defaultOn?: boolean;
  /** Year or date of the data, shown next to the name (e.g. orthophoto epochs). */
  date?: string;
}

/**
 * Basemaps (role "basemap", one at a time) and overlays (role "overlay", any number).
 * "arcgis" = an ArcGIS MapServer drawn through its /export endpoint (reprojects to Web Mercator,
 * so services in a national grid work too); `layers` is the ArcGIS "show:" list.
 */
export type MapLayerDef =
  | (MapLayerBase & { kind: "xyz"; url: string; role: "basemap" | "overlay" })
  | (MapLayerBase & { kind: "wms"; url: string; layers: string; role: "basemap" | "overlay" })
  | (MapLayerBase & { kind: "arcgis"; url: string; layers?: string; role: "basemap" | "overlay" })
  /** Drawn by the app from the API's /v1/contours (vector lines with labels). */
  | (MapLayerBase & { kind: "contours"; role: "overlay" });

/** A street found by name, to move the map there. */
export interface StreetHit {
  name: string;
  /** The same street name in separate places (e.g. different villages): stretch n of `of`, longest first. */
  part?: { n: number; of: number };
  postcodes: string[];
  center: LngLat;
  bbox: [number, number, number, number];
}

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
