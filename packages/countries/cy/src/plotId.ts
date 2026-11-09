import type { PlotIdentifier } from "@plotcheck/core";
import type { PlotIdSchema } from "@plotcheck/country-sdk";

/**
 * DLS nationalCadastralReference, observed format (2026-11-09):
 *   4000-40/56W1-3-1-666   →  municipality 4000 · sheet/plan 40/56W1 · section 3 · block 1 · plot 666
 *   4000-40/640201-3-10-139
 * Confirmed: municipality code (matches AU 3rd-order nationalCode) and plot number (matches cp:label).
 * NOT confirmed with DLS: the meaning of the 3rd and 4th segments ("section", "block").
 * Parsing is lenient so a wrong guess never blocks a lookup by full reference.
 */
const REF = /^(\d{4})-([^-]+)-([^-]+)-([^-]+)-([^-]+)$/;

export function parseNationalRef(ref: string): PlotIdentifier | null {
  const m = REF.exec(ref.trim());
  if (!m) return null;
  return {
    nationalRef: ref.trim(),
    districtCode: m[1]!.slice(0, 1),
    municipalityCode: m[1]!,
    sheetPlan: m[2]!,
    section: m[3]!,
    block: m[4]!,
    plot: m[5]!,
  };
}

export function formatNationalRef(id: PlotIdentifier): string | null {
  const { municipalityCode, sheetPlan, section, block, plot } = id;
  if (!municipalityCode || !sheetPlan || !section || !block || !plot) return null;
  return `${municipalityCode}-${sheetPlan}-${section}-${block}-${plot}`;
}

export const cyPlotIdSchema: PlotIdSchema = {
  fields: [
    { key: "districtCode", labelKey: "cy.field.district", required: true, kind: "select" },
    { key: "municipalityCode", labelKey: "cy.field.municipality", required: true, kind: "select", dependsOn: ["districtCode"] },
    { key: "sheetPlan", labelKey: "cy.field.sheetPlan", required: true, kind: "select", dependsOn: ["municipalityCode"] },
    { key: "block", labelKey: "cy.field.block", required: true, kind: "text", dependsOn: ["sheetPlan"] },
    { key: "plot", labelKey: "cy.field.plot", required: true, kind: "text" },
  ],
  parseNationalRef,
};
