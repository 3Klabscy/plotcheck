# Technical Plan — Plot Feasibility Platform (pre-code deliverable)

Status: **phase 1 built** (see README). Sections 5–7 updated with what the build confirmed.
Live checks against DLS were run on 2026-11-09. The findings are in §5.

---

## 1. Architecture at a glance

```
apps/
  app/            Expo + Expo Router (iOS, Android, web). MapLibre, i18next.
  seo/            Next.js SSR public pages (phase 4). Shares packages/*.
packages/
  core/           Country-agnostic domain: types, rules schema (OZFS-ext), units, money.
  engine/         Calculation engine (port of zoneR/tidyzoning checks). Pure TS, no I/O,
                  no country code. Runs on the client and in Edge Functions.
  geo/            Turf + proj4 helpers: CRS registry, polygon offset (setbacks), union.
  country-sdk/    The CountryModule interface (§2) + test harness every module must pass.
  countries/
    cy/           Cyprus module: providers, schemas, rules seed, i18n el/en, legal texts.
  i18n/           Shared UI strings (en) + per-country language packs.
supabase/
  migrations/     Postgres + PostGIS (EU region).
  functions/      Edge Functions: parcel-lookup, zone-lookup, restrictions, doc-scan,
                  rules-extract, assistant. All third-party keys live here only.
```

Rules that keep later phases from needing rewrites:
- **Engine is pure.** Input is `Site + ResolvedRules + Scenario + Params`, output is `Result`.
  Nothing in it knows about Cyprus. The financial model (phase 2) is a second pure function
  over the same `Result`.
- **Countries are data plus adapters.** `core` and `engine` never import from `countries/*`.
  A registry resolves `countryCode` to a module at runtime. A lint rule (eslint
  `no-restricted-imports`) enforces this.
- **Every external call goes through an Edge Function.** That gives one place for caching
  (PostGIS tables), rate limiting, secrets and source attribution.
- **Every value carries provenance.** Each rule value, restriction and price records
  `{ source, sourceRef, page?, fetchedAt, status: verified | needs_review, verifiedBy? }`.
  The UI shows a warning whenever a value has `needs_review` status.

## 2. Country-module interface (TypeScript, abridged)

```ts
// packages/country-sdk/src/CountryModule.ts
export interface CountryModule {
  code: string;                         // ISO 3166-1 alpha-2, e.g. "CY"
  locales: string[];                    // ["el", "en"]; first = default
  currency: CurrencyCode;               // "EUR"
  nativeCrs: string[];                  // e.g. ["EPSG:3048", "EPSG:4258"]
  jurisdiction: JurisdictionProvider;   // country → region → municipality → zone/plan
  parcelProviders: ParcelProvider[];    // tried in order, falls back on failure
  plotIdSchema: PlotIdSchema;           // fields + cascading dropdown sources
  docScanSchema: DocScanSchema;         // JSON schema for LLM extraction (no personal data)
  planningProviders: PlanningProvider[];
  restrictionLayers: RestrictionLayer[];
  ruleTerms: RuleTermMap;               // local term → common schema key (e.g. "συντελεστής δόμησης" → far)
  defaults: CountryDefaults;            // costs, prices, soft-cost %, taxes (overridden from DB)
  permitRoadmap?: PermitRoadmapSource;  // phase 6
  legal: LegalTexts;                    // disclaimers, ToS refs, per locale
  features: Partial<Record<FeatureFlag, boolean>>; // e.g. brokering disabled until licensed
}

export interface ParcelProvider {
  id: string;                           // "cy.dls.inspire.wfs"
  enabled: boolean;                     // PAL Survey ships as enabled:false
  getByPoint(p: LngLat, opts?: { radiusM?: number }): Promise<Parcel[]>; // neighbours near boundaries
  getById(id: PlotIdentifier): Promise<Parcel | null>;
  getCapabilities?(): Promise<ProviderCapabilities>; // CRS, limits, read at runtime
}

export interface Parcel {
  countryCode: string;
  providerId: string;
  nationalRef: string;                  // e.g. "4000-40/640201-3-10-139"
  identifiers: PlotIdentifier;          // decoded per plotIdSchema
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; // always stored as WGS84
  officialAreaM2?: number;
  adminUnits: AdminUnitRef[];
  provenance: Provenance;
}

export interface PlanningProvider {
  id: string;
  zonesAt(geom: GeoJSON.Geometry): Promise<ZoneHit[]>;  // a parcel can straddle zones
}

export interface RestrictionLayer {
  id: string; kind: RestrictionKind;    // road_widening | airport_height | coastal | flood | natura2000 | ...
  check(parcel: Parcel): Promise<RestrictionHit[]>;     // each hit has an effect + source
}

export type RestrictionEffect =
  | { type: "reduce_net_area"; areaM2: number }
  | { type: "cap_height"; maxHeightM: number }
  | { type: "cap_floors"; maxFloors: number }
  | { type: "block"; reason: string }
  | { type: "info" };
```

**Rules schema.** Extend OZFS: keep its `district → constraints → {min,max,expression}`
model and add `jurisdictionPath`, `inheritsFrom`, European terms (`far`, `coverage`,
`maxFloors`, `maxHeightM`, setbacks per edge type, `parkingPerUnit`, `bonuses[]`) and a
provenance block per value. `resolveRules(zone)` merges country → region → municipality →
plan → zone overrides before anything reaches the engine.

**Engine checks** (port from zoneR/tidyzoning, credited in NOTICE). Each check returns
`{ status: allowed | not_allowed | maybe, reason, inputs }`: use permitted, min plot area or
frontage, buildable footprint after setbacks (Turf buffer on a projected CRS), coverage,
FAR, floors, height and unit count. The spec's worked example is a unit test:
530 m², FAR 1.20, coverage 50 %, 4 floors → 636 m², 265 m², 3 floors, split 265/265/106.

## 3. Data model (Supabase, first cut)

`countries`, `jurisdictions` (ltree path, PostGIS geom), `zones`, `zone_rules` (jsonb
OZFS-ext with status, verified_by and source), `parcels_cache` (geom, national_ref, provider,
fetched_at, ttl), `restriction_layers`, `restriction_cache`, `defaults` (country/region,
cost/price/tax, jsonb), `checks` (user, parcel, scenario, result jsonb, engine_version),
`error_reports`, `audit_log`. Row-level security from day one. Later phases add tables;
they do not change these ones.

## 4. Phase 1 scope (only what will be built when phase 1 is requested)

Web only. Tap the map → `parcel-lookup` (DLS WFS BBOX/Intersects) → confirm the plot and
show neighbours → `zone-lookup` (DLS LU planning-zone layer) → choose a building type →
engine → headline result plus per-floor table, with the disclaimer. One verified Larnaca
zone seeded in `zone_rules`. The live DLS values are shown next to the seeded rule so any
mismatch is visible. el/en strings from the start. The CY module is the only module, and the
registry and lint boundary are in place.

## 5. Verified live against DLS (2026-11-09, anonymous access)

| Item | Finding |
|---|---|
| Cadastral WFS | `.../CP_CadastralParcels/MapServer/exts/InspireFeatureDownload/service` responds. Feature types: `cp:CadastralParcel`, `cp:CadastralBoundary`, `cp:CadastralZoning`. FES spatial operators include BBOX, Intersects and DWithin. |
| CRS | WFS default is **EPSG:4258** with **lat,lon axis order** in GML posList. It also offers 25836 (UTM 36N), 3048, 3035 and more. Handle the axis order explicitly in proj4. |
| Query by point | **Primary: ArcGIS REST `MapServer/1/query`** (envelope, `inSR=4326`, `f=geojson`), ~1 s. The INSPIRE WFS `GetFeature` BBOX works too but takes ~20 s, so it is the automatic fallback. |
| Query by identifier | REST `where=nationalCadastralRef='…'` ~1 s (WFS FES filter ~4–20 s). `LIKE` patterns also work (~0.7 s), so the phase-2 sheet/plan/block/plot search is feasible. |
| CORS | DLS reflects the request origin, so the browser loads orthophoto tiles and WMS overlays directly. |
| Planning zones | **Found.** `INSPIRE/LU_LandUse` layer `LU.ExistingLandUse_plnz`. WMS `GetFeatureInfo` (INFO_FORMAT=text/xml) at a Larnaca point returned zone `Πα5`, Coverage 0.7, Density 2.1, Height 10 m, AllowedStories 3, plan "ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΑΡΝΑΚΑΣ", last edited 2022-09-13. Native CRS 3048. REST `identify` is *not* enabled on this service. |
| Admin units | `INSPIRE/AU_AdmUnits` levels 1–4 with `nationalCode` (CY / 4 = Larnaca district / 4000 = municipality / 400003 = quarter). Usable for the cascading dropdowns and fuzzy matching. |
| Restriction candidates | `NZ_NaturalRiskZones`: floodplain 20/100/500-year, earthquake, geological hazards. `PS_ProtectedSites`: nature conservation (likely Natura 2000), landscape, geological. `TN_TransportNetwork`: road links (for the road-access check). `BU_Buildings`: footprints (for precedents and existing-building checks). |

Decision: zone values from DLS are treated as **source data with `needs_review` status**.
They prefill `zone_rules`, but a verified record (checked against the Local Plan text) always
wins. The layer is named *Existing* Land Use, while its content is planning zones. That needs
to be confirmed with DLS.

## 6. Could not verify (blocking or open)

**Cyprus data**
1. **Decoding `nationalCadastralReference`.** Examples: `4000-40/640201-3-10-139`,
   `4000-40/56W1-3-1-666`. Parsed as municipality – sheet/plan – section – block – plot.
   Municipality and plot are confirmed; sheet/plan looks right. The meaning of `40/640201`, `3` and `10`
   (sheet/plan/block/registration block) is not confirmed. Option B and document scan depend
   on this. Ask DLS for the format spec.
2. ~~Lookup by sheet/plan/block/plot~~ — **resolved**: the REST `LIKE` query works (~0.7 s).
   The section segment can be wildcarded.
3. **Authorised access.** All tests above were anonymous. The scope, rate limits, terms of use
   and the extra datasets that the provided credentials unlock (e.g. a token for the `:8445`
   endpoints) are unknown. Need the credentials and the licence text.
4. **Planning-zone completeness.** Does `plnz` cover all Local Plans, Policy Statement areas
   and village zones island-wide? What do `Unspecified` and `ParentZone` mean? Does it include
   setbacks, parking, special provisions and bonuses? (They appear not to; those need the Local
   Plan documents.)
5. **Is the WMS-GetFeatureInfo zoning data officially citable?** Also its update cadence
   relative to the Town Planning Department's gazetted plans.
6. **Restriction layers not yet found:** street alignment / road widening (Δημόσιοι Δρόμοι
   alignment plans), airport height limits (Larnaca and Paphos; Civil Aviation Dept), the
   coastal setback zone, archaeological sites (Dept of Antiquities), listed buildings (Town
   Planning), and the legal status of public road access. Whether `PS_ProtectedSites`
   "Nature Conservation" equals Natura 2000 is also unconfirmed.
7. **Sale prices and valuations (DLS portal checked 2026-11-09).** These are not public.
   - The DLS e-services site (eservices.dls.moi.gov.cy, behind CY Login / Ariadni) offers
     paid applications: **Comparative Sales Information** (application type 10) and
     **Comprehensive Parcel Information**. It also offers data **subscriptions**,
     **full-service downloads** and **static (dataset) downloads**. Its REST API
     (`/Services/Rest/...`) returns 401 without login.
   - The internal ArcGIS folders `/arcgis/rest/services/National` and `/DTPH` (Town
     Planning) return 403. They probably hold the richer cadastral and planning layers,
     and are likely what our "authorised access" covers.
   - Public sources: only aggregate sales statistics (portal "Στατιστικά Πωλήσεων") and
     the 2021 General Valuation information pages.
   - Action: confirm with DLS which subscription or download products, and which of the
     National/DTPH services, our credentials cover. Ask in particular about
     plot-level comparable sales, valuation values, and machine access (token
     authentication, not only manual applications through the website). PAL's Data
     Extraction service (item 9) is the fallback.
8. **Building permit records** for neighbourhood precedents. No source found.
9. **PAL Survey (checked 2026-11-09).** palsurveying.com has no public API or terms of use.
   maps.palsurveying.com rejects automated clients (HTTP 406). PAL sells "Data Extraction"
   as a service: cadastral data, valuation, planning zone, density, coverage, flood risk and
   ground suitability, delivered as JSON/GeoJSON/xlsx with monthly or yearly verification.
   Its maps are built on the same government datasets we already query from DLS. Plan:
   agree a data licence or API with PAL (P.A.L. Land Surveying & GIS, Larnaca,
   info@palsurveying.com). Then add `cy.pal` as a secondary provider that supports two
   modes: an API adapter, or a bulk GeoJSON import into `parcels_cache`/`zone_rules` with
   `source = PAL` and the delivery date. It stays `enabled: false` until a contract
   exists. No scraping.

**Rules and calculation**
10. OZFS: the current schema version and licence need checking before it is adapted.
11. zoneR and tidyzoning licences need checking before the logic is ported. They will be
    credited in NOTICE.
12. Cyprus specifics to confirm with a local architect: how verandas, balconies, staircases,
    basements and pilotis count against density and coverage; current density bonuses
    (green-building and incentive schemes); and parking norms per municipality.

**Legal and commercial**
13. Cyprus estate-agent licensing (Estate Agents Law, Council of Registration of Estate
    Agents): whether landowner–developer matching or success fees count as brokering.
14. Marketplace and advertising rules: ETEK rules on advertising by engineers and
    architects, consumer law for marketplace terms, VAT on cross-border digital services.
15. App Store and Play rules on credits versus subscriptions for "report" purchases that also
    unlock web features (RevenueCat ↔ Stripe shared entitlement).
16. Where GDPR and DLS terms allow us to cache and redistribute cadastral geometry in exported
    PDFs and SEO pages.

## 7. Phase 1 — what was built and decided

- **Zone seeded:** Κα4, Larnaca Local Plan (density 1.2, coverage 0.5, 3 storeys, 13.5 m, as
  DLS publishes). All values are `needs_review` until an architect checks the plan text.
- **Other zones** run on the DLS coefficients plus country defaults, flagged "not yet reviewed".
- **Continuous-building zones** (e.g. Πα5): side distances may be 0 m. The engine keeps 3 m
  (conservative) and reports "check needed".
- **Spec example:** the worked example (530 m² → 636 / 265 / 3 floors / 265-265-106) is a unit
  test. Note that DLS lists Κα4 as 3 storeys, not the 4 floors in the example.
- **Uses per zone** come from the zone-code letter (Κ/Ε/Π/Τ/Γ/Ζ/Β). This is a heuristic,
  flagged `needs_review`.
- **Still open for phase 2:**
  - restriction layers (flood, protected sites, road access);
  - DLS credentials for the National and DTPH services and comparable sales;
  - Greek copy review by a native speaker;
  - production tiles to replace OSM;
  - a brand name ("PlotCheck" is a placeholder).

## 8. Next step

Phase 2: lookup by plot details (REST `LIKE`) and by document scan; restriction warnings
(NZ flood, PS protected sites, TN road access); financial feasibility; paywall and credits.
Before that: the DLS credentials (§6 items 3 and 7) and an architect's check of Κα4.
