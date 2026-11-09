import type { Parcel, Provenance, Relaxation, SiteContext, UseType, ZoneHit } from "@plotcheck/core";
import { larnacaStreetFrontage } from "./larnaca/frontage.ts";
import { isContinuousBuilding } from "./rules.ts";

/**
 * Cyprus planning relaxations and incentives (πολεοδομικές χαλαρώσεις / κίνητρα).
 * Researched 2026-11-09. Every entry cites its instrument and source; all are "needs_review"
 * until checked by a registered architect/engineer. Values are ceilings, never guarantees.
 *
 * Island-wide entries apply to every plot within Local Plans, Area Plans and the Policy
 * Statement for the Countryside (Order 4/2026 §1.1–1.2). Area entries (e.g. Larnaca Local Plan)
 * are layered on top for that plan only.
 */

const ORDER_4_2026 = "https://www.etek.org.cy/uploads/2026/53422da1f0.pdf";
const src = (source: string, sourceRef: string, page?: string): Provenance => ({
  source,
  sourceRef,
  ...(page ? { page } : {}),
  fetchedAt: "2026-11-09",
  status: "needs_review",
});
const o426 = (para: string) => src("Εντολή 4/2026 (Υπουργός Εσωτερικών, άρθρο 6 Ν. 90/1972) — primary text", ORDER_4_2026, para);

const MULTI_UNIT: UseType[] = ["apartment_block", "row_houses", "mixed_use"];

// ---------- Island-wide ----------

const verandas: Relaxation = {
  id: "cy.o4-2026.verandas",
  tier: "entitlement",
  titleKey: "cy.relax.verandas.title",
  grantKey: "cy.relax.verandas.grant",
  conditionsKey: "cy.relax.verandas.conditions",
  instrument: "Εντολή 4/2026 §2.2.15(α), §2.2.15.2",
  effect: { excludedVerandaPct: 0.25 },
  quantified: true,
  provenance: o426("§2.2.15"),
};

const basement: Relaxation = {
  id: "cy.o4-2026.basement",
  tier: "entitlement",
  titleKey: "cy.relax.basement.title",
  grantKey: "cy.relax.basement.grant",
  conditionsKey: "cy.relax.basement.conditions",
  instrument: "Εντολή 4/2026 §2.2.1",
  effect: { basementExcluded: true },
  quantified: true,
  provenance: o426("§2.2.1"),
};

const pilotis: Relaxation = {
  id: "cy.o4-2026.pilotis",
  tier: "conditional",
  titleKey: "cy.relax.pilotis.title",
  grantKey: "cy.relax.pilotis.grant",
  conditionsKey: "cy.relax.pilotis.conditions",
  instrument: "Εντολή 4/2026 §2.2.7, §2.2.9, §4.7",
  effect: {},
  quantified: false,
  provenance: o426("§2.2.7"),
};

const roofAttic: Relaxation = {
  id: "cy.o4-2026.roof",
  tier: "entitlement",
  titleKey: "cy.relax.roof.title",
  grantKey: "cy.relax.roof.grant",
  conditionsKey: "cy.relax.roof.conditions",
  instrument: "Εντολή 4/2026 §2.2.14, §4.3",
  effect: {},
  quantified: false,
  provenance: o426("§2.2.14, §4.3"),
};

const officeHeight: Relaxation = {
  id: "cy.o4-2026.office-height",
  tier: "conditional",
  titleKey: "cy.relax.officeHeight.title",
  grantKey: "cy.relax.officeHeight.grant",
  conditionsKey: "cy.relax.officeHeight.conditions",
  instrument: "Εντολή 4/2026 §4.1.1",
  effect: { heightPerFloorM: 0.7 },
  uses: ["commercial", "mixed_use"],
  quantified: true,
  provenance: o426("§4.1.1"),
};

const extraFloors = (max: number): Relaxation => ({
  id: "cy.o4-2026.extra-floors",
  tier: "discretionary",
  titleKey: "cy.relax.extraFloors.title",
  grantKey: max === 2 ? "cy.relax.extraFloors.grant2" : "cy.relax.extraFloors.grant1",
  conditionsKey: "cy.relax.extraFloors.conditions",
  instrument: "Εντολή 4/2026 §4.1(ιζ), (κ), (κα)",
  effect: { floorsAdd: max },
  quantified: true,
  provenance: o426("§4.1"),
});

const slopeFloor: Relaxation = {
  id: "cy.o4-2026.slope",
  tier: "discretionary",
  titleKey: "cy.relax.slope.title",
  grantKey: "cy.relax.slope.grant",
  conditionsKey: "cy.relax.slope.conditions",
  instrument: "Εντολή 4/2026 §4.2",
  effect: {},
  quantified: false,
  provenance: o426("§4.2"),
};

const continuousSetback: Relaxation = {
  id: "cy.o4-2026.continuous",
  tier: "discretionary",
  titleKey: "cy.relax.continuous.title",
  grantKey: "cy.relax.continuous.grant",
  conditionsKey: "cy.relax.continuous.conditions",
  instrument: "Εντολή 4/2026 §5.1.1(α)",
  effect: { setbackM: 0 },
  quantified: true,
  provenance: o426("§5.1.1(α)"),
};

const upperSetbacks: Relaxation = {
  id: "cy.o4-2026.upper-setbacks",
  tier: "discretionary",
  titleKey: "cy.relax.upperSetbacks.title",
  grantKey: "cy.relax.upperSetbacks.grant",
  conditionsKey: "cy.relax.upperSetbacks.conditions",
  instrument: "Εντολή 4/2026 §5.8, §5.2",
  effect: { setbackM: 3 },
  quantified: true,
  provenance: o426("§5.8"),
};

const coverageAdjust: Relaxation = {
  id: "cy.o4-2026.coverage",
  tier: "discretionary",
  titleKey: "cy.relax.coverage.title",
  grantKey: "cy.relax.coverage.grant",
  conditionsKey: "cy.relax.coverage.conditions",
  instrument: "Εντολή 4/2026 §3 (αναπροσαρμογή ποσοστού κάλυψης)",
  effect: {},
  quantified: false,
  provenance: o426("§3"),
};

const res5: Relaxation = {
  id: "cy.o4-2025.res",
  tier: "conditional",
  titleKey: "cy.relax.res.title",
  grantKey: "cy.relax.res.grant",
  conditionsKey: "cy.relax.res.conditions",
  instrument: "Εντολή 4/2025 «Αύξηση της Ενεργειακής Απόδοσης Αναπτύξεων» (αντικαθιστά την Εντολή 1/2020)",
  effect: { farPct: 0.05 },
  quantified: true,
  provenance: src(
    "Εντολή 4/2025 — ETEK/ΕΟΑΛ publication notices (order text to be re-checked)",
    "https://eoal.org.cy/dimosiefsi-entolis-4-2025-gia-afxisi-tis-energeiakis-apodosis-anaptyxeon/",
  ),
};

/**
 * Σχέδιο Παροχής Πολεοδομικών Κινήτρων (affordable housing), Cabinet decision 16/4/2025, as tabled by
 * ΚΟΑΓ (cldc.org.cy, "Πολεοδομικά Κίνητρα", read 2026-11-09). Plot in a zone where housing is allowed:
 *   500–799 m²,  ΣΔ ≥ 1,20 → +25%, combines with other incentives up to 35% in total
 *   800–1.999 m², ΣΔ ≥ 1,20 → +45%, no combination (45% in total)
 *   ≥ 2.000 m²,  ΣΔ ≥ 1,00 → +45%, no combination
 *   ≥ 2.000 m²,  ΣΔ < 1,00 → +25%, combines up to 35%
 * Not in traditional cores, ΠΕΧ, Antiquities-controlled areas, listed buildings or next to them.
 * Ways: affordable units on site (20% of the permitted ΣΔ for +45%, 10% for +25%, sold to ΚΟΑΓ
 * beneficiaries at €1.650/m² buildable from 1/7/2024), elsewhere, for rent (+45%), or buy-out (way 4).
 */
export function nationalSchemeTier(plotAreaM2: number | undefined, baseFar: number | undefined): { pct: 0.25 | 0.45; combinable: boolean; totalMax: number } | undefined {
  if (plotAreaM2 === undefined || baseFar === undefined || plotAreaM2 < 500) return undefined;
  if (plotAreaM2 < 800) return baseFar >= 1.2 - 1e-9 ? { pct: 0.25, combinable: true, totalMax: 0.35 } : undefined;
  if (plotAreaM2 < 2000) return baseFar >= 1.2 - 1e-9 ? { pct: 0.45, combinable: false, totalMax: 0.45 } : undefined;
  return baseFar >= 1 - 1e-9 ? { pct: 0.45, combinable: false, totalMax: 0.45 } : { pct: 0.25, combinable: true, totalMax: 0.35 };
}

const KOAG = src("ΚΟΑΓ — Πολεοδομικά Κίνητρα (Απόφαση Υπουργικού Συμβουλίου 16/4/2025), πίνακας επιλεξιμότητας", "https://cldc.org.cy/en/utilization-of-urban-planning-incentive/urban-incentives/");

function schemeRelaxations(tier: NonNullable<ReturnType<typeof nationalSchemeTier>>): Relaxation[] {
  const pct = Math.round(tier.pct * 100);
  const combine: Partial<Relaxation> = tier.combinable ? { packageMaxPct: tier.totalMax } : { notCombinableWith: ["cy.o4-2025.res", "cy.lca.*"] };
  return [
    {
      id: "cy.scheme.affordable",
      tier: "conditional",
      titleKey: "cy.relax.affordable.title",
      grantKey: tier.combinable ? "cy.relax.affordable.grant25" : "cy.relax.affordable.grant45",
      conditionsKey: "cy.relax.affordable.conditions",
      instrument: `Σχέδιο Παροχής Πολεοδομικών Κινήτρων (Απόφαση Υπουργικού Συμβουλίου 16/4/2025) — +${pct}%`,
      effect: { farPct: tier.pct },
      cost: { type: "affordable_units", pctOfExtraUnits: tier.pct === 0.45 ? 0.2 / 0.45 : 0.1 / 0.25, noteKey: tier.combinable ? "cy.relax.affordable.cost25" : "cy.relax.affordable.cost45" },
      uses: MULTI_UNIT,
      exclusiveGroup: "cy.national-scheme",
      ...combine,
      quantified: true,
      statusNoteKey: "cy.relax.affordable.status",
      provenance: KOAG,
    },
    {
      id: "cy.scheme.buyout",
      tier: "conditional",
      titleKey: "cy.relax.buyout.title",
      grantKey: tier.combinable ? "cy.relax.buyout.grant25" : "cy.relax.buyout.grant45",
      conditionsKey: "cy.relax.buyout.conditions",
      instrument: `Σχέδιο Παροχής Πολεοδομικών Κινήτρων — Τρόπος 4, χρηματικό αντιστάθμισμα — +${pct}%`,
      effect: { farPct: tier.pct },
      cost: { type: "compensation", noteKey: "cy.relax.buyout.cost" },
      uses: MULTI_UNIT,
      exclusiveGroup: "cy.national-scheme",
      ...combine,
      quantified: true,
      statusNoteKey: "cy.relax.affordable.status",
      provenance: KOAG,
    },
  ];
}

const recovery: Relaxation = {
  id: "cy.scheme.recovery",
  tier: "conditional",
  titleKey: "cy.relax.recovery.title",
  grantKey: "cy.relax.recovery.grant",
  conditionsKey: "cy.relax.recovery.conditions",
  instrument: "Σχέδιο Παροχής Πολεοδομικών Κινήτρων για Ανάκαμψη (ΑΥΣ 75.172/29.05.2013 και τροποποιήσεις)",
  effect: {},
  cost: { type: "compensation", pctOfExcessValue: 0.5, noteKey: "cy.relax.recovery.cost" },
  exclusiveGroup: "cy.national-scheme",
  quantified: false,
  statusNoteKey: "cy.relax.affordable.status",
  provenance: src("Πρόταση προς το Υπουργικό Συμβούλιο Υ.Ε. 05.33.110 (15/12/2023) — primary text", "https://eoal.org.cy/wp-content/uploads/2024/07/Kin_an_13.pdf"),
};

const familyFloor: Relaxation = {
  id: "cy.scheme.family-floor",
  tier: "conditional",
  titleKey: "cy.relax.family.title",
  grantKey: "cy.relax.family.grant",
  conditionsKey: "cy.relax.family.conditions",
  instrument: "Σχέδιο Υπουργείου Εσωτερικών για στέγαση μελών οικογένειας (Σεπτέμβριος 2026)",
  effect: {},
  uses: ["house"],
  quantified: false,
  validUntil: "2027-12-31",
  provenance: src("Cyprus Mail 17/9/2026; Politis — press reports, scheme guide to be checked", "https://cyprus-mail.com/2026/09/17/ministry-unveils-new-scheme-allowing-families-to-build-extra-floor-for-relatives"),
};

// ---------- Larnaca Local Plan (plan 401) ----------
// Primary source: Τοπικό Σχέδιο Λάρνακας 2019 — Πρόνοιες και Μέτρα Πολιτικής (ΤΠΟ, Δεκ. 2019),
// chapters 11.6 (Urban Centre) and 12.8 (residential zones). Listed-building transfer limits per
// receiving zone are from a secondary source (Axia Valuers) and flagged as such.

const LP_LARNACA = "https://eoal.org.cy/wp-content/uploads/2024/07/Top_sx_3.pdf";
const lp = (para: string) => src("Τοπικό Σχέδιο Λάρνακας 2019 (ΤΠΟ) — primary text", LP_LARNACA, para);
const AXIA = "https://www.axiavaluers.com/en/news/36";
const axia = (part: string) => src(`Axia Valuers guide (28/5/2026) — secondary source, ${part}`, AXIA, part);

const lcaResCap = { group: "cy.lca.residential", maxPct: 0.3 };
const lcaUcCap = { group: "cy.lca.urban-centre", maxPct: 1.0 };
const TRANSFER_20 = { type: "transfer" as const, noteKey: "cy.relax.lcaUrban.cost" };

/** §12.8.2(γ): RES +5% in Κα/Πα/ΚΓ zones outside the Urban Centre — within the +30% cap (§12.8.3). */
const lcaResRes: Relaxation = { ...res5, cap: lcaResCap };

const lcaUnified: Relaxation = {
  id: "cy.lca.unified-complex",
  tier: "conditional",
  titleKey: "cy.relax.lcaUnified.title",
  grantKey: "cy.relax.lcaUnified.grant",
  conditionsKey: "cy.relax.lcaUnified.conditions",
  instrument: "Τοπικό Σχέδιο Λάρνακας §12.8.2(α), §12.8.3",
  effect: { farPct: 0.05 },
  exclusiveGroup: "cy.lca.complex",
  cap: lcaResCap,
  quantified: false, // needs 4+ normal-size plots developed together (plot merging)
  provenance: lp("§12.8.2(α), §12.8.3"),
};

const lcaSocial: Relaxation = {
  ...lcaUnified,
  id: "cy.lca.social-complex",
  titleKey: "cy.relax.lcaSocial.title",
  grantKey: "cy.relax.lcaSocial.grant",
  conditionsKey: "cy.relax.lcaSocial.conditions",
  instrument: "Τοπικό Σχέδιο Λάρνακας §12.8.2(β), §12.8.3, §12.9",
  effect: { farPct: 0.25 },
  provenance: lp("§12.8.2(β)"),
};

const lcaListed = (pct: number, key: string): Relaxation => ({
  id: "cy.lca.listed-transfer",
  tier: "conditional",
  titleKey: "cy.relax.listed.title",
  grantKey: key,
  conditionsKey: "cy.relax.listed.conditions",
  instrument: "Κ.Δ.Π. 89/2015 (μεταφορά συντελεστή δόμησης από διατηρητέες οικοδομές)",
  effect: { farPct: pct },
  cost: { type: "transfer", noteKey: "cy.relax.listed.cost" },
  quantified: true,
  provenance: axia("receiving-zone limits under Κ.Δ.Π. 89/2015"),
});

/** §11.6.2: selected streets of the Central Commercial Area. */
const lcaKep = (continuous: boolean): Relaxation => ({
  id: "cy.lca.urban-kep",
  tier: "conditional",
  titleKey: "cy.relax.lcaKep.title",
  grantKey: "cy.relax.lcaKep.grant",
  conditionsKey: "cy.relax.lcaKep.conditions",
  instrument: "Τοπικό Σχέδιο Λάρνακας §11.6.2.3, §11.6.5",
  effect: { farPct: 0.2, floorsAdd: 2, coverageMax: continuous ? 0.55 : 0.4, maxFar: 4 },
  minPlotAreaM2: 1000,
  uses: ["commercial", "mixed_use"], // central uses must exceed 60% of the development
  exclusiveGroup: "cy.lca.urban-street",
  cap: lcaUcCap,
  cost: TRANSFER_20,
  quantified: true,
  provenance: lp("§11.6.2"),
});

/** §11.6.3: commercial axes outside the ΚΕΠ — distances: 3 m road/sides on ground+1st, 5 m rear and upper floors. */
const AXIS_SETBACKS = [
  { condition: "floor <= 2", expression: 3 },
  { condition: true, expression: 5 },
];
const lcaAxis = (big: boolean): Relaxation => ({
  id: big ? "cy.lca.urban-axis-50" : "cy.lca.urban-axis-30",
  tier: "conditional",
  titleKey: "cy.relax.lcaAxis.title",
  grantKey: big ? "cy.relax.lcaAxis.grant50" : "cy.relax.lcaAxis.grant30",
  conditionsKey: "cy.relax.lcaAxis.conditions",
  instrument: "Τοπικό Σχέδιο Λάρνακας §11.6.3.2, §11.6.5",
  effect: { farPct: big ? 0.5 : 0.3, maxFloors: 12, coverageMax: 0.35, maxFar: 4, setbackRule: AXIS_SETBACKS },
  minPlotAreaM2: big ? 4000.01 : 1000,
  ...(big ? {} : { maxPlotAreaM2: 4000 }),
  uses: ["commercial", "mixed_use"], // central uses must exceed 60% of the development
  exclusiveGroup: "cy.lca.urban-street",
  cap: lcaUcCap,
  cost: TRANSFER_20,
  quantified: true,
  provenance: lp("§11.6.3"),
});

/** §11.6.4.1: +15% where ≥20% of the floor area is residential, in the ΚΕΠ or on the axes. */
const lcaUcHousingMix: Relaxation = {
  id: "cy.lca.uc-housing-mix",
  tier: "conditional",
  titleKey: "cy.relax.lcaMix.title",
  grantKey: "cy.relax.lcaMix.grant",
  conditionsKey: "cy.relax.lcaMix.conditions",
  instrument: "Τοπικό Σχέδιο Λάρνακας §11.6.4.1, §11.6.5",
  effect: { farPct: 0.15, maxFar: 4 },
  uses: ["mixed_use", "apartment_block"],
  cap: lcaUcCap,
  cost: TRANSFER_20,
  quantified: true,
  provenance: lp("§11.6.4.1"),
};

/** §11.6.4.2: residential zones inside the Urban Centre (needs Plan No. 6 boundary — note only for now). */
const lcaUcResidential: Relaxation = {
  id: "cy.lca.uc-residential",
  tier: "conditional",
  titleKey: "cy.relax.lcaUcRes.title",
  grantKey: "cy.relax.lcaUcRes.grant",
  conditionsKey: "cy.relax.lcaUcRes.conditions",
  instrument: "Τοπικό Σχέδιο Λάρνακας §11.6.4.2, §11.6.5",
  effect: { farPct: 0.3, floorsAdd: 2 },
  minPlotAreaM2: 1000,
  uses: ["apartment_block", "row_houses"],
  cost: TRANSFER_20,
  quantified: false,
  provenance: lp("§11.6.4.2"),
};

const lcaFloor128: Relaxation = {
  id: "cy.lca.res-extra-floor",
  tier: "discretionary",
  titleKey: "cy.relax.lcaFloor.title",
  grantKey: "cy.relax.lcaFloor.grant",
  conditionsKey: "cy.relax.lcaFloor.conditions",
  instrument: "Τοπικό Σχέδιο Λάρνακας §12.8.3(δ)",
  effect: {},
  quantified: false,
  provenance: lp("§12.8.3(δ)"),
};

// ---------- Selection ----------

const first = (z: ZoneHit) => z.zoneCode.trim().charAt(0);
const isCoreOrHistoric = (z: ZoneHit) => /ΙΣΤΟΡΙΚ|ΕΙΔΙΚΟΥ\s+ΧΑΡΑΚΤΗΡΑ|ΠΥΡΗΝ(ΑΣ|Α)?\s+ΟΙΚΙΣΜ/i.test(z.description ?? "");
const isPolicyStatement = (z: ZoneHit) => /ΔΗΛΩΣΗ\s+ΠΟΛΙΤΙΚΗΣ/i.test(z.planName ?? "");
const isLarnacaLP = (z: ZoneHit) => z.planRef === "401";
/** Κα, Πα and ΚΓ zones — the only zones where §12.8 incentives apply (§12.8.4). */
const isLcaResidentialZone = (z: ZoneHit) => /^(Κα|Πα|ΚΓ)/.test(z.zoneCode.trim());

export interface CyRelaxationContext {
  baseFar?: number;
  parcel?: Parcel;
  site?: SiteContext;
}

/** All relaxations that may apply to a plot in this zone. The engine decides how they combine. */
export function cyRelaxationsFor(zone: ZoneHit, ctx: CyRelaxationContext | number = {}): Relaxation[] {
  const { baseFar, parcel, site } = typeof ctx === "number" ? { baseFar: ctx, parcel: undefined, site: undefined } : ctx;
  const out: Relaxation[] = [verandas, basement, pilotis, roofAttic, coverageAdjust, upperSetbacks, slopeFloor, recovery, familyFloor];
  if (!isCoreOrHistoric(zone)) out.push(officeHeight);
  out.push(extraFloors(isPolicyStatement(zone) ? 1 : 2));
  if (isContinuousBuilding(zone)) out.push(continuousSetback);

  const commercial = first(zone) === "Ε";
  const tourist = first(zone) === "Τ";
  const agricultural = first(zone) === "Γ" || first(zone) === "Ζ";
  // national affordable-housing scheme: tier by plot area and the zone's density (ΚΟΑΓ table)
  const tier = !agricultural && !isCoreOrHistoric(zone) ? nationalSchemeTier(parcel?.officialAreaM2, baseFar) : undefined;
  if (tier) out.push(...schemeRelaxations(tier));

  if (!isLarnacaLP(zone)) {
    if (!agricultural) out.push(res5);
    return out;
  }

  // Larnaca Local Plan
  // plan-street frontage: DLS-named roads (site tags) or the OSM extract
  const frontage = parcel ? larnacaStreetFrontage(parcel) : [];
  const onKep = frontage.some((f) => f.group === "kep") || !!site?.tags.includes("cy.lca:kep");
  const onAxis = frontage.some((f) => f.group === "axis") || !!site?.tags.includes("cy.lca:axis");
  const inUrbanCentreStreet = onKep || onAxis;

  if (inUrbanCentreStreet && !isCoreOrHistoric(zone)) {
    if (onKep) out.push(lcaKep(isContinuousBuilding(zone)));
    if (onAxis) out.push(lcaAxis(false), lcaAxis(true));
    out.push(lcaUcHousingMix, res5);
  } else if (isLcaResidentialZone(zone) && !isCoreOrHistoric(zone)) {
    out.push(lcaResRes, lcaUnified, lcaSocial, lcaFloor128, lcaUcResidential);
  } else if (!agricultural) {
    out.push(res5);
  }
  if (isLcaResidentialZone(zone)) {
    out.push(lcaListed((baseFar ?? 0) < 0.6 ? 0.1 : 0.05, (baseFar ?? 0) < 0.6 ? "cy.relax.listed.grantRes10" : "cy.relax.listed.grantRes5"));
  } else if (commercial) {
    out.push(lcaListed(onKep ? 0.25 : 0.2, onKep ? "cy.relax.listed.grantKep" : "cy.relax.listed.grantCom"));
  } else if (tourist) {
    out.push(lcaListed(0.15, "cy.relax.listed.grantTour"));
  }
  return out;
}

/** Frontage details for the UI notes (which plan street the plot was found to front). */
export { larnacaStreetFrontage };

export const CY_RELAXATION_SOURCES = { ORDER_4_2026, AXIA, LP_LARNACA };
