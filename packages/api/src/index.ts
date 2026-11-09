import { resolveRules, USE_TYPES, type LngLat, type Parcel, type UseType, type ZoneHit, type ZoneRuleSet } from "@plotcheck/core";
import { analyse, compareScenarios, type AnalysisParams, type AnalysisResult } from "@plotcheck/engine";
import {
  AllProvidersFailedError,
  CountryNotSupportedError,
  countryForPoint,
  getCountry,
  listCountries,
  registerCountry,
  withFallback,
  type CountryModule,
  type ProviderContext,
} from "@plotcheck/country-sdk";
import { cached, type Cache } from "./cache.ts";
import { limitConcurrency, RateLimiter } from "./limits.ts";

export * from "./cache.ts";
export * from "./limits.ts";

export interface ApiDeps {
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  cache: Cache;
  /** Called once with each country module to register (keeps this package country-agnostic). */
  countries: CountryModule[];
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

const TTL = { point: 24 * 3600, parcel: 7 * 24 * 3600, zones: 24 * 3600 };

// ---------- validation helpers ----------
const isNum = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
function body<T>(raw: unknown): T & Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "invalid_body");
  return raw as T & Record<string, unknown>;
}
function str(x: unknown, name: string, max = 200): string {
  if (typeof x !== "string" || !x.trim() || x.length > max) throw new HttpError(400, "invalid_field", `${name} is required`);
  return x.trim();
}

function defaultParams(c: CountryModule): AnalysisParams {
  const d = c.defaults;
  return {
    storeyHeightM: d.storeyHeightM,
    netToGross: d.netToGrossResidential,
    unitMix: { studio: 0, bed1: 0.3, bed2: 0.5, bed3: 0.2 },
    unitSizeM2: d.avgUnitSizeM2,
    avgHouseSizeM2: d.avgHouseSizeM2,
    minRowHouseWidthM: d.minRowHouseWidthM,
  };
}

/** Accept only known, bounded numeric overrides from the client. */
function mergeParams(base: AnalysisParams, raw: unknown): AnalysisParams {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const out: AnalysisParams = { ...base, unitMix: { ...base.unitMix }, unitSizeM2: { ...base.unitSizeM2 } };
  if (isNum(r["storeyHeightM"], 2.5, 6)) out.storeyHeightM = r["storeyHeightM"];
  if (isNum(r["netToGross"], 0.5, 1)) out.netToGross = r["netToGross"];
  if (isNum(r["avgHouseSizeM2"], 40, 1000)) out.avgHouseSizeM2 = r["avgHouseSizeM2"];
  if (isNum(r["frontageM"], 1, 1000)) out.frontageM = r["frontageM"];
  for (const k of ["studio", "bed1", "bed2", "bed3"] as const) {
    const mix = (r["unitMix"] as Record<string, unknown> | undefined)?.[k];
    if (isNum(mix, 0, 1)) out.unitMix[k] = mix;
    const size = (r["unitSizeM2"] as Record<string, unknown> | undefined)?.[k];
    if (isNum(size, 20, 500)) out.unitSizeM2[k] = size;
  }
  return out;
}

export interface ZonesResponse {
  parcel: Parcel;
  zones: ZoneHit[];
  primary?: { zone: ZoneHit; rules: ZoneRuleSet; coverage: "curated" | "source_only"; mismatches: Mismatch[] };
}
export interface Mismatch {
  constraint: string;
  curated: number;
  published: number;
}

export function createApi(deps: ApiDeps) {
  deps.countries.forEach(registerCountry);
  const perClient = new RateLimiter(Number(deps.env("RATE_LIMIT_BURST") ?? 40), Number(deps.env("RATE_LIMIT_PER_SEC") ?? 0.5));
  const upstreamFetch = limitConcurrency(deps.fetch, Number(deps.env("UPSTREAM_CONCURRENCY") ?? 4));
  const ctx = (signal?: AbortSignal): ProviderContext => ({ fetch: upstreamFetch, env: deps.env, signal });
  const allowedOrigins = (deps.env("ALLOWED_ORIGINS") ?? "http://localhost:8081,http://localhost:19006").split(",").map((s) => s.trim());

  // ---------- operations ----------

  async function parcelsAtPoint(country: CountryModule, p: LngLat, signal?: AbortSignal) {
    const key = `pt:${country.code}:${p.lng.toFixed(5)}:${p.lat.toFixed(5)}`;
    const { value } = await cached(deps.cache, key, TTL.point, async () => {
      const { result, providerId, errors } = await withFallback(
        country.parcelProviders,
        (prov) => prov.getByPoint(ctx(signal), p, { radiusM: 15 }),
        (r) => r.length === 0,
      );
      return { parcels: result.slice(0, 12), providerId, errors };
    });
    for (const parcel of value.parcels) deps.cache.set(`parcel:${country.code}:${parcel.nationalRef}`, parcel, TTL.parcel).catch(() => undefined);
    return value;
  }

  async function parcelByRef(country: CountryModule, ref: string, signal?: AbortSignal): Promise<Parcel> {
    const { value } = await cached(deps.cache, `parcel:${country.code}:${ref}`, TTL.parcel, async () => {
      const { result } = await withFallback(country.parcelProviders, (prov) => prov.getById(ctx(signal), { nationalRef: ref }), (r) => r === null);
      if (!result) throw new HttpError(404, "parcel_not_found");
      return result;
    });
    return value;
  }

  async function zonesFor(country: CountryModule, parcel: Parcel, signal?: AbortSignal): Promise<ZonesResponse> {
    const { value: zones } = await cached(deps.cache, `zones:${country.code}:${parcel.nationalRef}`, TTL.zones, async () => {
      const { result } = await withFallback(country.planningProviders, (prov) => prov.zonesFor(ctx(signal), parcel), (r) => r.length === 0);
      return result;
    });
    const zone = zones[0];
    if (!zone) return { parcel, zones };
    const layers = [...country.ruleLayers, ...(country.sourceLayerForZone ? [country.sourceLayerForZone(zone)] : [])];
    const rules = resolveRules(zone.jurisdiction, zone.zoneCode, layers, zone.planRef);
    // Compare curated values with what the source publishes today (catches plan changes).
    const mismatches: Mismatch[] = [];
    if (rules.curated) {
      for (const [name, published] of Object.entries(zone.publishedConstraints)) {
        const curated = rules.constraints[name as keyof typeof rules.constraints]?.max_val?.[0]?.expression;
        if (typeof curated === "number" && Math.abs(curated - published) > 1e-9) mismatches.push({ constraint: name, curated, published });
      }
    }
    return { parcel, zones, primary: { zone, rules, coverage: rules.curated ? "curated" : "source_only", mismatches } };
  }

  // ---------- routes ----------

  async function route(req: Request): Promise<unknown> {
    const url = new URL(req.url);
    // Works behind any prefix, e.g. Supabase: /functions/v1/api/v1/analyse → /v1/analyse
    const path = url.pathname.replace(/^.*\/v1\//, "/v1/");

    if (req.method === "GET" && path === "/v1/health") return { ok: true };

    if (req.method === "GET" && path === "/v1/countries") {
      return {
        countries: listCountries().map((c) => ({
          code: c.code,
          nameKey: c.nameKey,
          locales: c.locales,
          currency: c.currency,
          bbox: c.bbox,
          defaultView: c.defaultView,
          mapLayers: c.mapLayers,
          messages: c.messages,
          plotIdFields: c.plotIdSchema.fields,
          features: c.features,
          coverage: c.coverage,
          legal: c.legal,
          defaults: defaultParams(c),
        })),
      };
    }

    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const b = body<Record<string, unknown>>(await req.json().catch(() => null));

    if (path === "/v1/parcels/at-point") {
      if (!isNum(b["lng"], -180, 180) || !isNum(b["lat"], -90, 90)) throw new HttpError(400, "invalid_point");
      const p = { lng: b["lng"], lat: b["lat"] };
      const country = typeof b["country"] === "string" ? getCountry(b["country"]) : countryForPoint(p);
      if (!country) throw new HttpError(404, "country_not_supported");
      const r = await parcelsAtPoint(country, p, req.signal);
      // the containing parcel plus neighbours close enough to be a plausible mis-tap
      const parcels = r.parcels.filter((x, i) => i === 0 || (x.distanceM ?? 0) <= 8);
      return { country: country.code, providerId: r.providerId, parcels };
    }

    const country = getCountry(str(b["country"], "country", 3));
    const ref = str(b["nationalRef"], "nationalRef");
    const parcel = await parcelByRef(country, ref, req.signal);

    if (path === "/v1/zones") return zonesFor(country, parcel, req.signal);

    if (path === "/v1/analyse") {
      const z = await zonesFor(country, parcel, req.signal);
      if (!z.primary) throw new HttpError(422, "no_zone", "No planning zone found for this plot");
      const params = mergeParams(defaultParams(country), b["params"]);
      const site = { geometry: parcel.geometry, officialAreaM2: parcel.officialAreaM2 };
      const useRaw = b["use"];
      let results: AnalysisResult[];
      if (useRaw === "all") results = compareScenarios({ site, rules: z.primary.rules, params });
      else {
        if (!USE_TYPES.includes(useRaw as UseType)) throw new HttpError(400, "invalid_use");
        results = [analyse({ site, rules: z.primary.rules, use: useRaw as UseType, params })];
      }
      return {
        parcel,
        zone: z.primary.zone,
        otherZones: z.zones.slice(1),
        coverage: z.primary.coverage,
        mismatches: z.primary.mismatches,
        rules: z.primary.rules,
        params,
        results,
        disclaimerKey: country.legal.disclaimerKey,
      };
    }
    throw new HttpError(404, "not_found");
  }

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    const cors: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,apikey,x-client-info",
      Vary: "Origin",
    };
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) cors["Access-Control-Allow-Origin"] = origin || "*";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const clientKey = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "anon";
    const rl = perClient.take(clientKey);
    const json = (status: number, data: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra } });
    if (!rl.ok) return json(429, { error: "rate_limited" }, { "Retry-After": String(rl.retryAfterS) });

    try {
      return json(200, await route(req));
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
      if (e instanceof CountryNotSupportedError) return json(404, { error: "country_not_supported" });
      if (e instanceof AllProvidersFailedError) return json(502, { error: "upstream_unavailable", message: "The official data service did not respond. Please try again." });
      console.error("api error", e);
      return json(500, { error: "internal" });
    }
  };
}
