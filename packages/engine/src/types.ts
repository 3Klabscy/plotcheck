import type { ConstraintName, PolygonGeometry, Provenance, Relaxation, UseType, ZoneRuleSet } from "@plotcheck/core";
import type { RelaxedScenario } from "./relax.ts";

export type CheckStatus = "allowed" | "not_allowed" | "maybe";

export interface Check {
  id: string;
  status: CheckStatus;
  /** i18n key, rendered client-side. */
  reasonKey: string;
  params?: Record<string, string | number>;
  constraint?: ConstraintName;
}

export interface UnitMix {
  studio: number;
  bed1: number;
  bed2: number;
  bed3: number;
}

export interface AnalysisParams {
  storeyHeightM: number;
  /** Sellable/net floor area as a share of gross buildable area (apartments, offices). */
  netToGross: number;
  /** Shares of each unit type (normalised internally). */
  unitMix: UnitMix;
  unitSizeM2: UnitMix;
  avgHouseSizeM2: number;
  minRowHouseWidthM: number;
  /** Plot frontage on the road, if known (needed for min-width and row-house checks). */
  frontageM?: number;
  /** Bonus ids from the rule set the user says apply (e.g. green building). */
  applyBonusIds?: string[];
}

export interface Site {
  /** WGS84 polygon of the (possibly merged) site. Optional: without it the setback check is skipped. */
  geometry?: PolygonGeometry;
  /** Legal area from the cadastre if known; otherwise computed from the geometry. */
  officialAreaM2?: number;
}

export interface AnalysisInput {
  site: Site;
  rules: ZoneRuleSet;
  use: UseType;
  params: AnalysisParams;
  /** Relaxations/incentives that apply to this plot (chosen by the country module). */
  relaxations?: Relaxation[];
}

export interface Figures {
  plotAreaM2: number;
  geometryAreaM2?: number;
  far: number;
  coverageRatio: number;
  maxGfaM2: number;
  maxCoverageM2: number;
  setbackM?: number;
  netFootprintM2?: number;
  /** Footprint used for the calculation: min(max coverage, footprint after setbacks). */
  footprintM2: number;
  maxStories?: number;
  maxHeightM?: number;
  floorsByHeight?: number;
  allowedFloors: number;
  feasibleFloors: number;
  achievableGfaM2: number;
  perFloorM2: number[];
  /** Boundary distance applied on each floor (index 0 = ground floor). */
  setbackByFloorM?: number[];
  buildingHeightM: number;
}

export interface UnitEstimate {
  sellableM2: number;
  total: number;
  byType: UnitMix;
  parking: { min: number; max: number };
}

export interface ReviewWarning {
  constraint: ConstraintName | "uses_allowed" | "unit_size";
  provenance: Provenance;
}

export interface AnalysisResult {
  engineVersion: string;
  use: UseType;
  zone: { code: string; name?: string; plan?: string; curated: boolean };
  status: CheckStatus;
  checks: Check[];
  figures: Figures;
  units?: UnitEstimate;
  houses?: { count: number; gfaEachM2: number; parking: { min: number; max: number } };
  commercial?: { gfaM2: number; netM2: number; parking: { min: number; max: number } };
  buildableFootprint?: PolygonGeometry;
  /** Values used that are not verified: the client must show these with a warning. */
  needsReview: ReviewWarning[];
  /** i18n keys for the "to be checked by an engineer" list. */
  toBeChecked: string[];
  /** Same plot with every available relaxation used, each one cited (only when relaxations were given). */
  relaxed?: RelaxedScenario;
}
