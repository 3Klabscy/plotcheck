import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import i18next from "i18next";
import { PDFDocument } from "pdf-lib";
import { areasFrom, comparableStats, finance } from "@plotcheck/engine";
import { compareOptions } from "../src/lib/options";
import el from "../src/locales/el";
import en from "../src/locales/en";
import cyEl from "../../../packages/countries/cy/src/i18n/el";
import cyEn from "../../../packages/countries/cy/src/i18n/en";
import { buildReport } from "../src/lib/report/build";

// Real API answers for plot 4000-40/56W1-3-1-666 (Larnaca, Κα4), saved 2026-11-09.
const fx = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/report-666.json", import.meta.url).href), "utf8"));
const font = (w: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../assets/fonts/NotoSans-${w}.ttf`, import.meta.url).href)));
const fonts = { regular: font("Regular"), bold: font("Bold") };

async function tFor(lng: string) {
  const i = i18next.createInstance();
  await i.init({ lng, resources: { el: { translation: { ...el, ...cyEl } }, en: { translation: { ...en, ...cyEn } } }, interpolation: { escapeValue: false } });
  return i.t.bind(i);
}

async function build(lng: string, use = "apartment_block", live = false) {
  const t = await tFor(lng);
  const result = fx.analysis.results.find((r: { use: string }) => r.use === use);
  const d = fx.analysis.finance.byUse[use];
  const src = result.relaxed ?? result;
  const areas = areasFrom(src, fx.analysis.params.netToGross, (result.relaxed?.applied ?? []).reduce((s: number, a: { contribution: { verandaM2?: number } }) => s + (a.contribution.verandaM2 ?? 0), 0));
  const params = { ...d, landPrice: 300000 };
  const tiles: string[] = [];
  const comps = comparableStats(
    [
      { date: "2026-10-03", price: 212_500, areaM2: 85, kind: "apartment", label: "Σωτήρος" },
      { date: "2026-08-20", price: 260_000, areaM2: 100, kind: "apartment", label: "Αγ. Νικόλαος" },
      { date: "2026-07-01", price: 243_000, areaM2: 90, kind: "apartment" },
      { date: "2026-06-12", price: 228_000, areaM2: 95, kind: "apartment" },
      { date: "2026-06-01", price: 700_000, areaM2: 80, kind: "apartment", label: "ρετιρέ με θέα" },
    ],
    { asOf: new Date("2026-11-09"), kind: "apartment" },
  )!;
  const options = compareOptions(fx.analysis, { relaxed: true, priceFor: (u) => (u === "commercial" ? undefined : { perM2: comps.meanPerM2, source: "comparables", count: comps.used.length }) });
  const pdf = await buildReport({
    t: t as never, lng, config: fx.config, zones: fx.zones, data: fx.analysis, result,
    finance: { use: use as never, scenario: result.relaxed ? "relaxed" : "base", finish: "standard", params, areas, result: finance(areas, params), priceSource: { perM2: params.salePricePerM2, source: "comparables", count: 2, edited: false } },
    comparables: comps, options,
    fonts, generatedAt: new Date("2026-11-09T18:30:00Z"),
    ...(live ? {} : { fetchBytes: async (u: string) => { tiles.push(u); return undefined; } }),
  });
  return { pdf, tiles, options, comps };
}

describe("option comparison", () => {
  it("lists every allowed use with sales value, construction cost and land value, best first", async () => {
    const { options, comps } = await build("el");
    expect(comps.excluded).toHaveLength(1); // the €8,750/m² penthouse
    expect(options.map((o) => o.use)).not.toContain(undefined);
    for (const o of options) {
      expect(o.finance.gdv).toBeGreaterThan(0);
      expect(o.finance.hardCost).toBeGreaterThan(0);
    }
    const sorted = [...options].sort((a, b) => b.finance.residualLandValue - a.finance.residualLandValue);
    expect(options.map((o) => o.use)).toEqual(sorted.map((o) => o.use));
    const apt = options.find((o) => o.use === "apartment_block")!;
    expect(apt.price).toMatchObject({ source: "comparables", perM2: comps.meanPerM2 });
    expect(apt.relaxed).toBe(true);
  }, 30_000);
});

describe("PDF report", () => {
  it("builds a Greek report with the map tiles of the plot's area", async () => {
    const { pdf, tiles } = await build("el");
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(doc.getTitle()).toBe("Τεμάχιο 666");
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]).toMatch(/Orthoimagery_2019_WebMercator\/MapServer\/tile\/\d+\/\d+\/\d+$/);
    expect(pdf.length).toBeLessThan(400_000); // fonts are subset
  }, 30_000);
  it("builds in English and for a use that is not allowed", async () => {
    for (const use of ["house", "commercial"]) {
      const { pdf } = await build("en", use);
      expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(2);
    }
  }, 30_000);
  it.runIf(!!process.env["REPORT_OUT"])("writes a live report for inspection", async () => {
    for (const lng of ["el", "en"]) writeFileSync(`${process.env["REPORT_OUT"]}/report-${lng}.pdf`, (await build(lng, "apartment_block", true)).pdf);
  }, 60_000);
});
