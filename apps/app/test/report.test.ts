import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import i18next from "i18next";
import { PDFDocument } from "pdf-lib";
import { areasFrom, finance } from "@plotcheck/engine";
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
  const pdf = await buildReport({
    t: t as never, lng, config: fx.config, zones: fx.zones, data: fx.analysis, result,
    finance: { use: use as never, scenario: result.relaxed ? "relaxed" : "base", finish: "standard", params, areas, result: finance(areas, params) },
    fonts, generatedAt: new Date("2026-11-09T18:30:00Z"),
    ...(live ? {} : { fetchBytes: async (u: string) => { tiles.push(u); return undefined; } }),
  });
  return { pdf, tiles };
}

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
