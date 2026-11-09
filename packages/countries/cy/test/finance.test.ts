import { describe, expect, it } from "vitest";
import type { Parcel, ZoneHit } from "@plotcheck/core";
import { finance } from "@plotcheck/engine";
import { cyFinanceDefaults, officialLandValue } from "../src/index.ts";

const parcel = (municipalityCode: string, quarter: string | undefined, area: number) =>
  ({ identifiers: { municipalityCode, ...(quarter ? { quarter } : {}) }, officialAreaM2: area }) as unknown as Parcel;
const zone = (zoneCode: string) => ({ zoneCode, planRef: "ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΑΡΝΑΚΑΣ" }) as unknown as ZoneHit;

describe("Cyprus finance defaults", () => {
  it("prices Larnaca town above the district default and keeps fee bands", () => {
    const town = cyFinanceDefaults(parcel("4000", "03", 700), zone("Κα4"));
    const other = cyFinanceDefaults(parcel("4999", undefined, 700), undefined);
    expect(town.byUse.apartment_block.salePricePerM2).toBeGreaterThan(other.byUse.apartment_block.salePricePerM2);
    expect(town.byUse.apartment_block.landPurchaseFeeBands.map((b) => b.rate)).toEqual([0.03, 0.05, 0.08]);
    expect(town.sources.length).toBeGreaterThan(0);
    expect(other.officialLandValue).toBeUndefined();
  });

  it("a standard Larnaca apartment scheme leaves a positive residual land value", () => {
    const d = cyFinanceDefaults(parcel("4000", "03", 700), zone("Κα4"));
    const r = finance({ gfaM2: 840, footprintM2: 350, residentialNetM2: 689, commercialNetM2: 0, verandaM2: 0 }, d.byUse.apartment_block);
    expect(r.residualLandValue).toBeGreaterThan(0);
  });
});

describe("DLS General Valuation 2021", () => {
  it("finds the value for the plot's quarter and zone (Sotiros, Κα4)", () => {
    const v = officialLandValue(parcel("4000", "03", 700), zone("Κα4"))!;
    expect(v.areaKey).toBe("ΛΑΡΝΑΚΑΣΩΤΗΡΟΣ");
    expect(v.perM2Buildable).toBe(333);
    expect(v.far).toBe(1.2);
    expect(v.total).toBe(Math.round(700 * 1.2 * 333));
    expect(v.date).toBe("2021-01-01");
  });

  it("returns nothing for a zone without a published value", () => {
    expect(officialLandValue(parcel("4000", "03", 700), zone("ΧΧ9"))).toBeUndefined();
  });

  it("without a quarter, uses the town-wide value DLS publishes (not a random quarter)", () => {
    const v = officialLandValue(parcel("4000", undefined, 700), zone("Κα4"))!;
    expect(v.areaKey).toBe("ΛΑΡΝΑΚΑ");
    expect(v.perM2Buildable).toBe(233);
  });
});
