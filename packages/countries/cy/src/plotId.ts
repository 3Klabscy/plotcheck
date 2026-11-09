import type { PlotIdentifier } from "@plotcheck/core";
import type { PlotIdSchema, PlotSearchIndex } from "@plotcheck/country-sdk";

/**
 * DLS nationalCadastralReference, observed format (2026-11-09):
 *   4000-40/56W1-3-1-666   →  municipality 4000 · sheet/plan 40/56W1 · quarter 3 · block 1 · plot 666
 *   4000-40/640201-3-10-139
 * Confirmed 2026-11-09: municipality = AU 3rd-order code; quarter = DLS Cadastral Zoning 4th order
 * (municipality code + 2-digit quarter, e.g. 400003 = Σωτήρος), checked on 5 plots; plot = cp:label.
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
    quarter: m[3]!,
    block: m[4]!,
    plot: m[5]!,
  };
}

export function formatNationalRef(id: PlotIdentifier): string | null {
  const { municipalityCode, sheetPlan, quarter, block, plot } = id;
  if (!municipalityCode || !sheetPlan || !quarter || !block || !plot) return null;
  return `${municipalityCode}-${sheetPlan}-${quarter}-${block}-${plot}`.replace(/\s+/g, "");
}

export const cyPlotIdSchema: PlotIdSchema = {
  fields: [
    { key: "districtCode", labelKey: "cy.field.district", required: true, kind: "select" },
    { key: "municipalityCode", labelKey: "cy.field.municipality", required: true, kind: "select", dependsOn: ["districtCode"] },
    { key: "quarter", labelKey: "cy.field.quarter", required: true, kind: "select", dependsOn: ["municipalityCode"] },
    { key: "sheetPlan", labelKey: "cy.field.sheetPlan", required: true, kind: "select", dependsOn: ["quarter"] },
    { key: "block", labelKey: "cy.field.block", required: true, kind: "select", dependsOn: ["sheetPlan"] },
    { key: "plot", labelKey: "cy.field.plot", required: true, kind: "text" },
  ],
  parseNationalRef,
  formatNationalRef,
  async searchIndex(region: string): Promise<PlotSearchIndex | undefined> {
    // Larnaca district (4) for now; other districts are added with tools/build_cy_plot_index.py
    if (region !== "4") return undefined;
    const data = (await import("../data/larnaca-plot-index.json", { with: { type: "json" } })).default as unknown as PlotSearchIndex & { district: string };
    return { ...data, region: data.district };
  },
};
