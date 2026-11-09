import { describe, expect, it } from "vitest";
import { comparableStats } from "@plotcheck/engine";
import { ComparablesError, parseCsv, parseDate, parseNumber, rowsToComparables } from "../src/lib/comparables";

describe("reading comparable sales", () => {
  it("reads Greek and English numbers and dates", () => {
    expect(parseNumber("250.000")).toBe(250000);
    expect(parseNumber("€ 250.000,50")).toBe(250000.5);
    expect(parseNumber("250,000.50")).toBe(250000.5);
    expect(parseNumber("85,5 τ.μ.")).toBe(85.5);
    expect(parseNumber("1,250")).toBe(1250);
    expect(parseDate("15/07/2026")).toBe("2026-07-15");
    expect(parseDate("2026-7-3")).toBe("2026-07-03");
    expect(parseDate(46218)).toBe("2026-07-15"); // Excel serial
  });
  it("finds the columns of a Greek semicolon CSV and averages the last 6 months", () => {
    const csv = [
      "Αρ.;Ημερομηνία πωλησης;Είδος ακινήτου;Τοποθεσία;Εμβαδόν (τ.μ.);Τίμημα (€)",
      "1;03/10/2026;Διαμέρισμα;Σωτήρος, Λάρνακα;85;212.500",
      '2;20/08/2026;Διαμέρισμα;"Αγ. Νικόλαος; Λάρνακα";100;260.000,00',
      "3;01/02/2026;Διαμέρισμα;Λάρνακα;90;180.000",
      "4;15/07/2026;Μονοκατοικία;Αραδίππου;180;360.000",
      "5;;Διαμέρισμα;χωρίς ημερομηνία;80;200.000",
    ].join("\n");
    const r = rowsToComparables(parseCsv(csv), "apartment");
    expect(r.sales).toHaveLength(4);
    expect(r.skipped).toBe(1);
    expect(r.columns).toMatchObject({ date: "Ημερομηνία πωλησης", price: "Τίμημα (€)", area: "Εμβαδόν (τ.μ.)", kind: "Είδος ακινήτου" });
    expect(r.sales[1]!.label).toBe("Αγ. Νικόλαος; Λάρνακα");
    expect(r.sales.map((s) => s.kind)).toEqual(["apartment", "apartment", "apartment", "house"]);
    const st = comparableStats(r.sales, { asOf: new Date("2026-11-09"), kind: "apartment" })!;
    expect(st.inPeriod).toBe(2); // the February sale is older than 6 months
    expect(st.meanPerM2).toBe(2550);
  });
  it("explains what is missing", () => {
    expect(() => rowsToComparables([["a", "b"], ["1", "2"]], "apartment")).toThrow(ComparablesError);
  });
});
