import { describe, expect, it } from "vitest";
import { comparableStats, type ComparableSale } from "../src/index.ts";

const s = (date: string, price: number, areaM2: number, kind: ComparableSale["kind"] = "apartment"): ComparableSale => ({ date, price, areaM2, kind });
const asOf = new Date("2026-11-09T00:00:00Z");

describe("comparable sales", () => {
  const sales = [
    s("2026-10-01", 200_000, 80), // 2,500
    s("2026-09-15", 260_000, 100), // 2,600
    s("2026-07-20", 216_000, 90), // 2,400
    s("2026-06-01", 270_000, 100), // 2,700
    s("2026-05-20", 900_000, 100), // 9,000: outlier
    s("2026-03-01", 150_000, 100), // older than 6 months
    s("2026-08-01", 300_000, 150, "house"), // 2,000, other kind
  ];
  it("keeps the last 6 months, removes outliers and averages per m²", () => {
    const r = comparableStats(sales, { asOf, kind: "apartment" })!;
    expect(r.from).toBe("2026-05-09");
    expect(r.inPeriod).toBe(5);
    expect(r.excluded.map((x) => x.price)).toEqual([900_000]);
    expect(r.meanPerM2).toBe(2550);
    expect(r.medianPerM2).toBe(2550);
    expect([r.minPerM2, r.maxPerM2]).toEqual([2400, 2700]);
  });
  it("can mix kinds or use a longer period", () => {
    expect(comparableStats(sales, { asOf, kind: "all" })!.inPeriod).toBe(6);
    expect(comparableStats(sales, { asOf, months: 12, kind: "apartment" })!.inPeriod).toBe(6);
  });
  it("returns nothing without usable sales", () => {
    expect(comparableStats([s("2026-10-01", 0, 80)], { asOf })).toBeUndefined();
    expect(comparableStats(sales, { asOf, kind: "land" })).toBeUndefined();
  });
});
