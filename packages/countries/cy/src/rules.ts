import { constant, type Provenance, type RuleLayer, type UseType, type ZoneHit } from "@plotcheck/core";

/**
 * Cyprus rule layers shipped with the module. Everything here is status "needs_review"
 * until a registered architect/engineer verifies it against the plan text. The admin
 * panel (phase 3) stores verified versions in the database, which override these.
 */

const assumption = (note: string): Provenance => ({
  source: "Country default (assumption, pending verification)",
  sourceRef: note,
  status: "needs_review",
});

/**
 * Distance from side/rear boundaries, stepping back with height: 3 m up to the 3rd floor,
 * 4 m on the 4th, 5 m from the 5th floor up. Local Plans, Annex B §11.1(ε), as illustrated in
 * the ETEK guide to planning regulations (Feb 2025, Diagram 37). Order 4/2026 §5.8 lets the
 * authority reduce the upper-floor distances (modelled as a relaxation).
 */
export const steppedBoundary = {
  min_val: [
    { condition: "floor <= 3", expression: 3 },
    { condition: "floor == 4", expression: 4 },
    { condition: true, expression: 5 },
  ],
  provenance: {
    source: "Local Plans Annex B §11.1(ε) — via ETEK guide to planning regulations (2025), Diagram 37",
    sourceRef: "https://www.etek.org.cy/uploads/2025/d2d58622Yh.pdf",
    page: "p. 41",
    status: "needs_review" as const,
  },
  notes: "3 m up to the 3rd floor, 4 m on the 4th floor, 5 m from the 5th floor up.",
};

/** Country-wide fallbacks (lowest precedence). */
export const cyCountryLayer: RuleLayer = {
  level: "country",
  match: { path: ["CY"] },
  constraints: {
    setback_dist_boundary: steppedBoundary,
    parking_per_unit: { min_val: [{ expression: [1, 1.5] }], provenance: assumption("Indicative 1–1.5 spaces per dwelling; check the Local Plan parking norms."), notes: "Range: minimum to typical." },
    parking_per_100m2_commercial: { min_val: [{ expression: [2.5, 3.3] }], provenance: assumption("Indicative 1 space per 30–40 m² of commercial floor area.") },
  },
};

const PREFIX_SOURCE: Provenance = {
  source: "Zone-code convention (first letter of the Cyprus zone code)",
  sourceRef: "Κ=residential, Ε=commercial, Π=core/mixed, Τ=tourist, Γ=agricultural, Ζ=protection, Β=industrial, Α=public uses",
  status: "needs_review",
};

type UseRule = { allowed: UseType[]; conditional: UseType[] };
const BY_PREFIX: Record<string, UseRule> = {
  "Κ": { allowed: ["house", "apartment_block", "row_houses"], conditional: ["commercial", "mixed_use"] },
  "Ε": { allowed: ["commercial", "mixed_use", "apartment_block"], conditional: ["house", "row_houses"] },
  "Π": { allowed: ["apartment_block", "house", "row_houses", "mixed_use"], conditional: ["commercial"] },
  "Τ": { allowed: [], conditional: ["apartment_block", "house", "row_houses", "commercial", "mixed_use"] },
  "Γ": { allowed: [], conditional: ["house"] },
  "Ζ": { allowed: [], conditional: [] },
  "Β": { allowed: [], conditional: ["commercial"] },
  // Αα: "other public uses" (stadia, schools, government buildings) — not for private development
  "Α": { allowed: [], conditional: [] },
};

/** Permitted uses from the zone code prefix; unknown prefixes → null (engine says "maybe"). */
export function cyUsesForZone(zone: ZoneHit): { value: UseType[] | null; conditional: UseType[]; provenance: Provenance } {
  const rule = BY_PREFIX[zone.zoneCode.trim().charAt(0)];
  if (!rule) return { value: null, conditional: [], provenance: PREFIX_SOURCE };
  return { value: [...rule.allowed, ...rule.conditional], conditional: rule.conditional, provenance: PREFIX_SOURCE };
}

/** Zones described as continuous building ("συνεχούς δόμησης") normally allow building on side boundaries. */
export const isContinuousBuilding = (zone: ZoneHit) => /ΣΥΝΕΧΟΥΣ\s+ΔΟΜΗΣΗΣ|συνεχούς\s+δόμησης/i.test(zone.description ?? "");

/**
 * Undecidable without the plan text: 0 m where the continuous system applies, otherwise 3 m.
 * Encoded as an OZFS free-text condition, so the engine keeps the conservative 3 m but reports "maybe".
 */
const continuousBuildingSetback = {
  min_val: [
    { condition: "Continuous building system applies to this plot (building on side boundaries permitted)", expression: 0 },
    { condition: true, expression: 3 },
  ],
  provenance: assumption("Continuous-building zone: side distances may be 0 m; confirm in the Local Plan."),
  notes: "Conservative 3 m used until the zone is reviewed.",
};

/** Build the "source" rule layer from what DLS publishes for this zone. */
export function cySourceLayer(zone: ZoneHit): RuleLayer {
  const pc = zone.publishedConstraints;
  const pv = zone.provenance;
  const uses = cyUsesForZone(zone);
  return {
    level: "source",
    match: { path: zone.jurisdiction.path, dist_abbr: zone.zoneCode, ...(zone.planRef ? { plan: zone.planRef } : {}) },
    dist_name: zone.description,
    ...(zone.planName ? { plan: { name: zone.planName, ...(zone.planRef ? { ref: zone.planRef } : {}) } } : {}),
    uses_allowed: { value: uses.value, provenance: uses.provenance },
    uses_conditional: uses.conditional,
    constraints: {
      ...(isContinuousBuilding(zone) ? { setback_dist_boundary: continuousBuildingSetback } : {}),
      ...(pc.far !== undefined ? { far: constant("max", pc.far, pv) } : {}),
      ...(pc.lot_cov_bldg !== undefined ? { lot_cov_bldg: constant("max", pc.lot_cov_bldg, pv) } : {}),
      ...(pc.stories !== undefined ? { stories: constant("max", pc.stories, pv) } : {}),
      ...(pc.height !== undefined ? { height: constant("max", pc.height, pv) } : {}),
    },
    curated: false,
    updatedAt: pv.sourceUpdatedAt ?? pv.fetchedAt ?? new Date(0).toISOString(),
  };
}

// ---------- Curated zones (phase 1: one Larnaca zone) ----------

const LARNACA_LP = { name: "ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΑΡΝΑΚΑΣ", ref: "401" };
const ka4Source: Provenance = {
  source: "Larnaca Local Plan — zone Κα4 (record prepared from DLS published coefficients; plan text not yet checked)",
  sourceRef: "Department of Town Planning and Housing — Τοπικό Σχέδιο Λάρνακας",
  status: "needs_review",
};

/**
 * Larnaca Local Plan, zone Κα4 ("areas with predominant residential use").
 * Coefficients as published by DLS on 2026-11-09: density 1.20, coverage 0.50, 3 storeys, 13.5 m.
 * Must be verified against the gazetted plan text before the "needs_review" flag is lifted.
 */
export const larnacaKa4: RuleLayer = {
  level: "zone",
  match: { path: ["CY", "4"], plan: LARNACA_LP.ref, dist_abbr: "Κα4" },
  dist_name: "Περιοχές με επικρατούσα χρήση την κατοικία",
  plan: LARNACA_LP,
  uses_allowed: { value: ["house", "apartment_block", "row_houses", "commercial", "mixed_use"], provenance: ka4Source },
  uses_conditional: ["commercial", "mixed_use"],
  constraints: {
    far: constant("max", 1.2, ka4Source),
    lot_cov_bldg: constant("max", 0.5, ka4Source),
    stories: constant("max", 3, ka4Source),
    height: constant("max", 13.5, ka4Source),
    setback_dist_boundary: steppedBoundary,
    parking_per_unit: { min_val: [{ expression: [1, 1.5] }], provenance: ka4Source },
  },
  provisions: [
    { text: "Front building line follows the street alignment / road widening plan where one exists.", provenance: ka4Source },
    { text: "Shops serving the neighbourhood may be permitted under conditions; check with the planning authority.", provenance: ka4Source },
  ],
  curated: true,
  updatedAt: "2026-11-09",
};

/** Larnaca Local Plan, plan-wide: dwelling standards (Table 12.1 "other areas", §12.12.8). */
export const larnacaPlanLayer: RuleLayer = {
  level: "plan",
  match: { path: ["CY", "4"], plan: "401" },
  dwellings: {
    minUsableM2: { studio: 35, bed1: 50, bed2: 75, bed3: 95 },
    maxStudioShare: { share: 0.25, fromUnits: 5 },
    provenance: {
      source: "Τοπικό Σχέδιο Λάρνακας 2019, Πίνακας 12.1 (λοιπές περιοχές) και §12.12.8 — primary text",
      sourceRef: "https://eoal.org.cy/wp-content/uploads/2024/07/Top_sx_3.pdf",
      page: "§12.12",
      status: "needs_review",
    },
  },
};

export const cyRuleLayers: RuleLayer[] = [cyCountryLayer, larnacaPlanLayer, larnacaKa4];
