// Country-agnostic domain types. Nothing in this file may reference a specific country.

export type LngLat = { lng: number; lat: number };

/** GeoJSON geometry, always WGS84 (EPSG:4326) lon/lat order once inside our system. */
export type PolygonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type CurrencyCode = "EUR" | "PLN" | "CZK" | "SEK" | "HUF" | "RON" | "DKK" | (string & {});

export type ReviewStatus = "verified" | "needs_review";

/** Where a value came from. Attached to every rule, parcel and restriction value. */
export interface Provenance {
  source: string; // human-readable source name, e.g. "DLS INSPIRE LU planning zones"
  sourceRef?: string; // URL, dataset id or document reference
  page?: string; // page / article in a planning document
  fetchedAt?: string; // ISO timestamp when we read it
  sourceUpdatedAt?: string; // when the source says it was last edited
  status: ReviewStatus;
  verifiedBy?: string; // registered architect/engineer id or name
}

/** Building types the user can ask about. Shared vocabulary across countries. */
export type UseType = "apartment_block" | "house" | "row_houses" | "commercial" | "mixed_use";
export const USE_TYPES: UseType[] = ["apartment_block", "house", "row_houses", "commercial", "mixed_use"];

/** Country-specific plot identifier, fields defined by the country's PlotIdSchema. */
export type PlotIdentifier = Record<string, string>;

export interface AdminUnitRef {
  level: number; // 1 = country, increasing = smaller
  code: string;
  name?: string;
}

export interface Parcel {
  countryCode: string;
  providerId: string;
  /** Stable id inside the provider (used for caching / dedupe). */
  providerParcelId: string;
  nationalRef: string;
  label?: string; // what the user calls it, e.g. plot number
  identifiers: PlotIdentifier;
  geometry: PolygonGeometry;
  officialAreaM2?: number;
  adminUnits: AdminUnitRef[];
  provenance: Provenance;
  /** Distance from the queried point (0 = point is inside). Set by getByPoint. */
  distanceM?: number;
}

export interface Jurisdiction {
  /** Path from country downward, e.g. ["CY", "CY-4", "4000"]. */
  path: string[];
  names?: Record<string, string>;
}

export interface ZoneHit {
  zoneCode: string;
  zoneName?: string;
  description?: string;
  planName?: string;
  planRef?: string;
  jurisdiction: Jurisdiction;
  /** Approximate share of the parcel in this zone (0..1), from point sampling. */
  share: number;
  /** Raw coefficients as published by the source, mapped to OZFS-EU constraint names. */
  publishedConstraints: Partial<Record<ConstraintName, number>>;
  provenance: Provenance;
}

// ---------- Rules (OZFS-EU) ----------

/**
 * Constraint names follow OZFS Appendix A where a term exists (far, lot_cov_bldg, stories,
 * height, lot_area, lot_width, setback_*, total_units, unit_size). Extensions for European
 * planning terms are prefixed with nothing but documented here:
 *  - parking_per_unit: parking spaces required per dwelling unit
 *  - parking_per_100m2_commercial: spaces per 100 m² of commercial floor area
 *  - lot_cov_bldg is a FRACTION (0..1), not a percentage
 * Units are metric (m, m²). OZFS uses feet; we deliberately diverge (metric-only product).
 */
export type ConstraintName =
  | "far"
  | "lot_cov_bldg"
  | "stories"
  | "height"
  | "lot_area"
  | "lot_width"
  | "setback_front"
  | "setback_side_int"
  | "setback_rear"
  | "setback_dist_boundary"
  | "total_units"
  | "unit_size"
  | "parking_per_unit"
  | "parking_per_100m2_commercial";

/** OZFS value entry: an expression (number or Python-syntax string), optionally conditional. */
export interface ConstraintValue {
  expression: number | string | (number | string)[];
  /** Python-syntax logical expression, `true`, or free text (unencodable -> engine says "maybe"). */
  condition?: string | boolean;
  /** When expression is a list: which of the evaluated values applies. */
  min_max?: "min" | "max";
}

export interface Constraint {
  min_val?: ConstraintValue[];
  max_val?: ConstraintValue[];
  notes?: string;
  provenance: Provenance;
}

export interface Bonus {
  id: string;
  description: string;
  /** Additional FAR (absolute, e.g. 0.1) when the bonus applies. */
  farAdd?: number;
  condition?: string;
  provenance: Provenance;
}

export interface ZoneRuleSet {
  schema: "ozfs-eu/0.1";
  jurisdiction: Jurisdiction;
  dist_abbr: string; // zone code, e.g. "Κα4"
  dist_name?: string;
  plan?: { name: string; ref?: string };
  /** null = unknown (engine returns "maybe"); [] = nothing allowed. */
  uses_allowed: { value: UseType[] | null; provenance: Provenance };
  /** Uses permitted only under conditions (engine returns "maybe"). */
  uses_conditional?: UseType[];
  constraints: Partial<Record<ConstraintName, Constraint>>;
  bonuses: Bonus[];
  provisions: { text: string; provenance: Provenance }[];
  /** True when a human-curated record exists for this zone (vs. source data only). */
  curated: boolean;
  updatedAt: string;
  /** Dwelling standards: minimum usable floor area per unit type and studio share cap. */
  dwellings?: DwellingRules;
}

export interface DwellingRules {
  minUsableM2: { studio: number; bed1: number; bed2: number; bed3: number };
  /** Max share of studios in developments of `fromUnits` units or more. */
  maxStudioShare?: { share: number; fromUnits: number };
  provenance: Provenance;
}

/** A partial rule set used at one level of the jurisdiction hierarchy (country, region, plan, zone). */
export type RuleLayer = {
  level: "country" | "region" | "municipality" | "plan" | "zone" | "source";
  /** path = jurisdiction prefix; plan = plan reference (a zone code can repeat across plans). */
  match: { path?: string[]; plan?: string; dist_abbr?: string; dist_prefix?: string };
} & Partial<Omit<ZoneRuleSet, "schema" | "jurisdiction" | "dist_abbr">>;

// ---------- Relaxations / planning incentives (country-agnostic model) ----------

/**
 * How firm a relaxation is:
 *  - entitlement: applies as of right when its conditions are met (e.g. verandas not counted)
 *  - conditional: granted on application if conditions/obligations are met (e.g. +5% for RES)
 *  - discretionary: the planning authority MAY grant it (e.g. extra floors); never assumed silently
 */
export type RelaxationTier = "entitlement" | "conditional" | "discretionary";

export interface RelaxationEffect {
  /** Density uplift as a share of the zone's base density (0.05 = +5 %). */
  farPct?: number;
  /** Absolute density uplift (0.25 = +0.25:1). */
  farAdd?: number;
  /** Extra floors over the zone maximum. */
  floorsAdd?: number;
  /** Extra permitted height per floor (m), e.g. offices +0.70 m. */
  heightPerFloorM?: number;
  /** Covered verandas/balconies not counted in density, as a share of each floor's built area. */
  excludedVerandaPct?: number;
  /** Basement for parking/storage/plant not counted in density. */
  basementExcluded?: boolean;
  /** Side/rear boundary distance that may apply instead of the default (m). */
  setbackM?: number;
  /** Boundary-distance rule imposed by a scheme when used (OZFS min_val entries, may use `floor`). */
  setbackRule?: ConstraintValue[];
  /** Coverage the scheme imposes when used (fraction). */
  coverageMax?: number;
  /** Floors permitted (up to this number) when the scheme is used, e.g. "up to 12 floors". */
  maxFloors?: number;
  /** Absolute density ceiling the scheme imposes. */
  maxFar?: number;
}

export interface RelaxationCost {
  type: "none" | "compensation" | "affordable_units" | "transfer" | "other";
  /** compensation: share of the value of the extra floor area (at the official valuation). */
  pctOfExcessValue?: number;
  /** affordable_units: share of the EXTRA units to be made available as affordable housing. */
  pctOfExtraUnits?: number;
  /** affordable_units: share of the PERMITTED (base) floor area to be sold at a fixed price. */
  affordableShareOfPermitted?: number;
  /** affordable_units: that fixed price, per m² of buildable floor area. */
  fixedPricePerM2Buildable?: number;
  /** compensation: payment = incentive floor area × factor × official value of building density per m². */
  compensationFactor?: number;
  noteKey?: string;
}

export interface Relaxation {
  id: string;
  tier: RelaxationTier;
  /** i18n keys (country module messages): title, what it grants, conditions. */
  titleKey: string;
  grantKey: string;
  conditionsKey: string;
  /** Legal instrument, e.g. "Εντολή 4/2026 §2.2.15". */
  instrument: string;
  effect: RelaxationEffect;
  cost?: RelaxationCost;
  /** Uses it applies to; undefined = all. */
  uses?: UseType[];
  minPlotAreaM2?: number;
  maxPlotAreaM2?: number;
  /** Only one relaxation per exclusive group can be used (e.g. national schemes: one per property). */
  exclusiveGroup?: string;
  /** Ids (or id prefixes ending in "*") this relaxation must not be combined with. */
  notCombinableWith?: string[];
  /** Combined farPct of all relaxations in the same cap group may not exceed maxPct. */
  cap?: { group: string; maxPct: number };
  /** When this relaxation is used, the combined farPct of the whole package may not exceed this
   *  (e.g. a scheme that "combines with other incentives up to 35% in total"). */
  packageMaxPct?: number;
  /** Applied to the figures (true) or listed as a note only (false). */
  quantified: boolean;
  validUntil?: string;
  /** Shown when validity/terms could not be confirmed from a primary source. */
  statusNoteKey?: string;
  provenance: Provenance;
}

// ---------- Site context (road access, frontage, postcodes) ----------

export interface SiteFrontage {
  name: string | null; // official street name, null if the road is unnamed in the data
  lengthM: number;
  postcodes: number[];
}

export interface SiteContext {
  roadAccess: "yes" | "no" | "unknown";
  frontage: SiteFrontage[];
  postcodes: number[];
  /** Country-specific tags used by rule selection (e.g. "cy.lca:axis"). */
  tags: string[];
  provenance: Provenance;
  /** Ground elevation across the plot, metres above mean sea level. */
  elevation?: SiteElevation;
  /** What stands on the plot today, from the surface model minus the terrain model. */
  structures?: SiteStructures;
}

export interface SiteStructures {
  /** Area of the plot covered by something ≥ 2.5 m above the ground (buildings or trees). */
  raisedM2: number;
  /** Share of the plot area. */
  raisedShare: number;
  /** Height of the tallest part (98th percentile, to ignore poles and wires), metres. */
  maxHeightM: number;
  source: string;
  provenance: Provenance;
}

export interface SiteElevation {
  minM: number;
  maxM: number;
  meanM: number;
  /** Number of points sampled on the plot. */
  points: number;
  /** e.g. "DTM 2019" */
  source: string;
  resolutionM: number;
  provenance: Provenance;
}
