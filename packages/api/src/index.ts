import { resolveRules, USE_TYPES, type LngLat, type Parcel, type SiteContext, type UseType, type ZoneHit, type ZoneRuleSet } from "@plotcheck/core";
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
  type RestrictionHit,
} from "@plotcheck/country-sdk";
import { cached, type Cache } from "./cache.ts";
import { googleTiles } from "./googleMaps.ts";
import { arcgisLegend } from "./legend.ts";
import { limitConcurrency, RateLimiter } from "./limits.ts";
import { BillingError, createBilling } from "./billing.ts";

export * from "./cache.ts";
export * from "./limits.ts";
export * from "./billing.ts";

/** Free tier: the relaxations in detail and the finance are left out; a preview of the gain stays. */
export function basicOnly(r: AnalysisResult): AnalysisResult & { relaxedPreview?: { gfaM2: number; floors: number; units?: number; gainM2: number } } {
  const { relaxed: x, ...rest } = r;
  if (!x) return rest;
  return { ...rest, relaxedPreview: { gfaM2: x.figures.achievableGfaM2, floors: x.figures.feasibleFloors, ...(x.units ? { units: x.units.total } : {}), gainM2: x.gain.gfaM2 } };
}

class Redirect {
  constructor(public location: string) {}
}

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
  site?: SiteContext;
  restrictions: RestrictionHit[];
  primary?: { zone: ZoneHit; rules: ZoneRuleSet; coverage: "curated" | "source_only"; mismatches: Mismatch[] };
}
export interface Mismatch {
  constraint: string;
  curated: number;
  published: number;
}

function toEngineEffect(e: RestrictionHit["effect"]) {
  switch (e.type) {
    case "cap_height":
      return { type: "cap_height" as const, maxHeightM: e.maxHeightM };
    case "cap_floors":
      return { type: "cap_floors" as const, maxFloors: e.maxFloors };
    case "block":
      return { type: "block" as const, reason: e.reason };
    default:
      return { type: "info" as const };
  }
}

export function createApi(deps: ApiDeps) {
  deps.countries.forEach(registerCountry);
  const perClient = new RateLimiter(Number(deps.env("RATE_LIMIT_BURST") ?? 40), Number(deps.env("RATE_LIMIT_PER_SEC") ?? 0.5));
  const upstreamFetch = limitConcurrency(deps.fetch, Number(deps.env("UPSTREAM_CONCURRENCY") ?? 4));
  const ctx = (signal?: AbortSignal): ProviderContext => ({ fetch: upstreamFetch, env: deps.env, signal });
  const billing = createBilling({ fetch: deps.fetch, env: deps.env });
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
    const [site, layerHits] = await Promise.all([
      country.siteContext ? country.siteContext(ctx(signal), parcel).catch(() => undefined) : Promise.resolve(undefined),
      cached(deps.cache, `restrict:${country.code}:${parcel.nationalRef}`, TTL.zones, async () =>
        (await Promise.all(country.restrictionLayers.filter((l) => l.enabled).map((l) => l.check(ctx(signal), parcel).catch(() => [] as RestrictionHit[])))).flat(),
      ).then((r) => r.value),
    ]);
    const zone = zones[0];
    const restrictions = [...layerHits, ...(zone && country.restrictionsForZone ? country.restrictionsForZone(zone) : [])];
    if (!zone) return { parcel, zones, restrictions, ...(site ? { site } : {}) };
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
    return { parcel, zones, restrictions, ...(site ? { site } : {}), primary: { zone, rules, coverage: rules.curated ? "curated" : "source_only", mismatches } };
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
          ...(c.nationalGrid ? { nationalGrid: c.nationalGrid } : {}),
          messages: c.messages,
          plotIdFields: c.plotIdSchema.fields,
          features: c.features,
          coverage: c.coverage,
          legal: c.legal,
          defaults: defaultParams(c),
        })),
      };
    }

    // ---------- billing ----------
    if (req.method === "GET" && path === "/v1/billing/plans") {
      const plans = await billing.plans();
      return { enabled: billing.enabled, providers: billing.providers, plans: plans.map((p) => ({ id: p.id, kind: p.kind, name: p.name, description: p.description, price_cents: p.price_cents, currency: p.currency, interval: p.interval })) };
    }
    if (req.method === "GET" && path === "/v1/me/access") {
      const c = url.searchParams.get("country") ?? undefined, r = url.searchParams.get("ref") ?? undefined;
      return billing.access(req, c, r && r.length <= 60 ? r : undefined);
    }
    if (req.method === "POST" && path === "/v1/billing/webhook/stripe") return billing.stripeWebhook(req);
    if (req.method === "GET" && path === "/v1/billing/jcc/return") return new Redirect((await billing.jccReturn(url)).redirect);

    if (req.method === "GET" && path === "/v1/area-info") {
      const c = getCountry(url.searchParams.get("country") ?? "");
      const layer = url.searchParams.get("layer") ?? "";
      const lng = Number(url.searchParams.get("lng")), lat = Number(url.searchParams.get("lat"));
      if (!isNum(lng, -180, 180) || !isNum(lat, -90, 90)) throw new HttpError(400, "invalid_point");
      const def = c.mapLayers.find((l) => l.id === layer);
      if (!def?.info || !c.areaInfo) throw new HttpError(404, "no_area_info");
      const key = `area-info:${c.code}:${layer}:${lng.toFixed(4)},${lat.toFixed(4)}`;
      const { value } = await cached(deps.cache, key, 7 * 24 * 3600, async () => (await c.areaInfo!(ctx(req.signal), layer, { lng, lat })) ?? { areas: [], sourceKey: "" });
      return value;
    }

    if (req.method === "GET" && path === "/v1/map-legend") {
      const c = getCountry(url.searchParams.get("country") ?? "");
      const def = c.mapLayers.find((l) => l.id === (url.searchParams.get("layer") ?? ""));
      if (!def || !def.legend || def.kind !== "arcgis") throw new HttpError(404, "no_legend");
      const ids = /^show:([\d,]{1,200})$/.exec(url.searchParams.get("layers") ?? "")?.[1]?.split(",").map(Number) ?? [];
      return { items: await arcgisLegend(deps, def.url, ids) };
    }

    if (req.method === "GET" && path === "/v1/maps/google") {
      try {
        return await googleTiles(deps, url.searchParams.get("lang") === "en" ? "en" : "el");
      } catch {
        return { available: false };
      }
    }

    if (req.method === "GET" && path === "/v1/plot-index") {
      const c = getCountry(url.searchParams.get("country") ?? "");
      const region = url.searchParams.get("region") ?? "";
      if (!/^[0-9A-Za-z-]{1,10}$/.test(region)) throw new HttpError(400, "invalid_region");
      const idx = await c.plotIdSchema.searchIndex?.(region);
      if (!idx) throw new HttpError(404, "region_not_covered");
      return idx;
    }

    if (req.method === "GET" && path === "/v1/contours") {
      const c = getCountry(url.searchParams.get("country") ?? "");
      const b = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
      if (b.length !== 4 || b.some((x) => !Number.isFinite(x)) || b[2]! <= b[0]! || b[3]! <= b[1]!) throw new HttpError(400, "invalid_bbox");
      if (b[2]! - b[0]! > 0.012 || b[3]! - b[1]! > 0.01) throw new HttpError(400, "bbox_too_large");
      if (!c.contours) throw new HttpError(404, "contours_not_supported");
      // snap to a ~250 m grid so neighbouring requests share the cache
      const q = 0.0025;
      const box: [number, number, number, number] = [Math.floor(b[0]! / q) * q, Math.floor(b[1]! / q) * q, Math.ceil(b[2]! / q) * q, Math.ceil(b[3]! / q) * q];
      const { value } = await cached(deps.cache, `contours:${c.code}:${box.map((x) => x.toFixed(4)).join(",")}`, TTL.zones, async () => (await c.contours!(ctx(req.signal), box)) ?? { type: "FeatureCollection", features: [] });
      return value;
    }

    if (req.method === "GET" && path === "/v1/streets") {
      const c = getCountry(url.searchParams.get("country") ?? "");
      const q = (url.searchParams.get("q") ?? "").slice(0, 60);
      return { country: c.code, streets: c.streetSearch?.(q, { limit: 12 }) ?? [] };
    }

    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const b = body<Record<string, unknown>>(await req.json().catch(() => null));

    if (path === "/v1/billing/checkout") return billing.checkout(req, b);
    if (path === "/v1/billing/portal") return billing.portal(req);

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

    if (path === "/v1/parcels/by-id") {
      const ids = b["identifiers"];
      if (!ids || typeof ids !== "object") throw new HttpError(400, "invalid_identifiers");
      const clean = Object.fromEntries(Object.entries(ids as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.length <= 40).map(([k, v]) => [k, (v as string).trim()]));
      const ref = clean["nationalRef"] ?? country.plotIdSchema.formatNationalRef?.(clean);
      if (!ref) throw new HttpError(400, "invalid_identifiers");
      const parcel = await parcelByRef(country, ref, req.signal);
      return { country: country.code, parcels: [parcel] };
    }

    if (path === "/v1/parcels/in-box") {
      const plot = typeof b["plot"] === "string" ? b["plot"].trim() : "";
      const bb = b["bbox"];
      if (!plot || plot.length > 20) throw new HttpError(400, "invalid_identifiers");
      if (!Array.isArray(bb) || bb.length !== 4 || !bb.every((x) => typeof x === "number" && Number.isFinite(x))) throw new HttpError(400, "invalid_bbox");
      const box = bb as [number, number, number, number];
      if (box[2] - box[0] > 0.2 || box[3] - box[1] > 0.2 || box[2] <= box[0] || box[3] <= box[1]) throw new HttpError(400, "bbox_too_large");
      const prov = country.parcelProviders.find((p) => p.enabled && p.findInBox);
      if (!prov) throw new HttpError(404, "search_not_supported");
      return { country: country.code, parcels: await prov.findInBox!(ctx(req.signal), plot, box) };
    }

    if (path === "/v1/parcels/search") {
      const ids = b["identifiers"];
      if (!ids || typeof ids !== "object") throw new HttpError(400, "invalid_identifiers");
      const clean = Object.fromEntries(Object.entries(ids as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.length <= 40).map(([k, v]) => [k, (v as string).trim()]));
      const providers = country.parcelProviders.filter((p) => p.enabled && p.search);
      if (providers.length === 0) throw new HttpError(404, "search_not_supported");
      const key = `search:${country.code}:${JSON.stringify(Object.entries(clean).sort())}`;
      const { value } = await cached(deps.cache, key, TTL.parcel, async () => {
        const { result } = await withFallback(providers, (prov) => prov.search!(ctx(req.signal), clean, { limit: 50 }), (r) => r.length === 0);
        return result ?? [];
      });
      return { country: country.code, parcels: value };
    }

    const ref = str(b["nationalRef"], "nationalRef");
    const parcel = await parcelByRef(country, ref, req.signal);

    if (path === "/v1/zones") return zonesFor(country, parcel, req.signal);

    if (path === "/v1/terrain") {
      if (!country.terrainModel) throw new HttpError(404, "terrain_not_supported");
      const raw = b["bufferM"];
      const bufferM = typeof raw === "number" && Number.isFinite(raw) ? Math.round(Math.min(200, Math.max(10, raw))) : 100;
      const { value } = await cached(deps.cache, `terrain:${country.code}:${parcel.nationalRef}:${bufferM}`, TTL.parcel, async () => {
        const t = await country.terrainModel!(ctx(req.signal), parcel, bufferM);
        if (!t) throw new HttpError(404, "no_terrain");
        return t;
      });
      return { ...value, geometry: parcel.geometry };
    }

    if (path === "/v1/analyse") {
      const z = await zonesFor(country, parcel, req.signal);
      if (!z.primary) throw new HttpError(422, "no_zone", "No planning zone found for this plot");
      const params = mergeParams(defaultParams(country), b["params"]);
      const site = {
        geometry: parcel.geometry,
        officialAreaM2: parcel.officialAreaM2,
        ...(z.site ? { roadAccess: z.site.roadAccess } : {}),
        restrictions: z.restrictions.map((h) => ({ id: h.layerId, severity: h.severity, messageKey: h.messageKey, ...(h.params ? { params: h.params } : {}), effect: toEngineEffect(h.effect) })),
      };
      const baseFar = z.primary.rules.constraints.far?.max_val?.[0]?.expression;
      const relaxations = country.relaxationsFor?.(z.primary.zone, { baseFar: typeof baseFar === "number" ? baseFar : undefined, parcel, ...(z.site ? { site: z.site } : {}) }) ?? [];
      const useRaw = b["use"];
      let results: AnalysisResult[];
      if (useRaw === "all") results = compareScenarios({ site, rules: z.primary.rules, params, relaxations });
      else {
        if (!USE_TYPES.includes(useRaw as UseType)) throw new HttpError(400, "invalid_use");
        results = [analyse({ site, rules: z.primary.rules, use: useRaw as UseType, params, relaxations })];
      }
      // paid parts only for users with a subscription or an unlock of this plot
      const acc = await billing.access(req, country.code, parcel.nationalRef);
      if (!acc.full) results = results.map(basicOnly);
      return {
        access: { full: acc.full, signedIn: acc.signedIn, billing: acc.enabled },
        parcel,
        zone: z.primary.zone,
        otherZones: z.zones.slice(1),
        site: z.site,
        restrictions: z.restrictions,
        ...(acc.full ? { finance: country.financeDefaults?.(parcel, z.primary.zone) } : {}),
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
      "Access-Control-Allow-Headers": "Content-Type,Authorization,apikey,x-client-info,Stripe-Signature",
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
      const out = await route(req);
      if (out instanceof Redirect) return new Response(null, { status: 302, headers: { Location: out.location, ...cors } });
      return json(200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
      if (e instanceof BillingError) return json(e.status, { error: e.code });
      if (e instanceof CountryNotSupportedError) return json(404, { error: "country_not_supported" });
      if (e instanceof AllProvidersFailedError) return json(502, { error: "upstream_unavailable", message: "The official data service did not respond. Please try again." });
      console.error("api error", e);
      return json(500, { error: "internal" });
    }
  };
}
