import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createApi, MemoryCache } from "../src/index.ts";
import { cyprus } from "@plotcheck/country-cy";

const fx = (n: string) => readFileSync(new URL(`../../countries/cy/test/fixtures/${n}`, import.meta.url), "utf8");
const fakeFetch = (async (url: string) => {
  const u = String(url);
  if (/MapServer\/1\/query/.test(u)) return new Response(fx("rest-query-bbox.geojson"));
  if (/GetFeatureInfo/.test(u)) return new Response(fx("wms-gfi-ka4.xml"));
  return new Response("nope", { status: 404 });
}) as typeof fetch;

const api = createApi({ fetch: fakeFetch, env: () => undefined, cache: new MemoryCache(), countries: [cyprus] });
const post = (path: string, body: unknown) => api(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("api (fixtures)", () => {
  it("routes behind a Supabase prefix", async () => {
    const r = await api(new Request("http://x/functions/v1/api/v1/health"));
    expect(r.status).toBe(200);
  });
  it("point → parcels → analyse", async () => {
    const p = await (await post("/v1/parcels/at-point", { lng: 33.615, lat: 34.93 })).json();
    expect(p.country).toBe("CY");
    expect(p.parcels[0].nationalRef).toBe("4000-40/56W1-3-1-666");
    const a = await (await post("/v1/analyse", { country: "CY", nationalRef: p.parcels[0].nationalRef, use: "apartment_block" })).json();
    expect(a.zone.zoneCode).toBe("Κα4");
    expect(a.coverage).toBe("curated");
    expect(a.results[0].figures.maxGfaM2).toBeCloseTo(837.6, 1);
  });
  it("validates input", async () => {
    expect((await post("/v1/parcels/at-point", { lng: "x" })).status).toBe(400);
    expect((await post("/v1/analyse", { country: "CY", nationalRef: "4000-40/56W1-3-1-666", use: "castle" })).status).toBe(400);
    expect((await post("/v1/analyse", { country: "ZZ", nationalRef: "1", use: "house" })).status).toBe(404);
  });
  it("rate limits per client", async () => {
    const tight = createApi({ fetch: fakeFetch, env: (k) => ({ RATE_LIMIT_BURST: "2", RATE_LIMIT_PER_SEC: "0.001" })[k], cache: new MemoryCache(), countries: [cyprus] });
    const h = () => tight(new Request("http://x/v1/health", { headers: { "x-forwarded-for": "1.2.3.4" } }));
    await h(); await h();
    expect((await h()).status).toBe(429);
  });
});

describe("plot search", () => {
  it("serves the Larnaca index and rejects uncovered regions", async () => {
    const idx = await (await api(new Request("http://x/v1/plot-index?country=CY&region=4"))).json();
    expect(idx.municipalities.length).toBeGreaterThan(50);
    const lar = idx.municipalities.find((m: { code: string }) => m.code === "4000");
    expect(lar.el).toBe("Λάρνακα");
    expect(lar.sheets["40/56W1"]["3-1"]).toBeGreaterThan(0); // plot 666's sheet/quarter/block
    expect((await api(new Request("http://x/v1/plot-index?country=CY&region=9"))).status).toBe(404);
  });
  it("finds a plot from its details", async () => {
    const r = await (await post("/v1/parcels/by-id", { country: "CY", identifiers: { municipalityCode: "4000", sheetPlan: "40/56W1", quarter: "3", block: "1", plot: "666" } })).json();
    expect(r.parcels[0].nationalRef).toBe("4000-40/56W1-3-1-666");
    expect((await post("/v1/parcels/by-id", { country: "CY", identifiers: { municipalityCode: "4000" } })).status).toBe(400);
  });
  it("searches plots by partial details (DLS 'by plot') and streets by name", async () => {
    const r = await (await post("/v1/parcels/search", { country: "CY", identifiers: { municipalityCode: "4000", plot: "666" } })).json();
    expect(r.parcels.length).toBeGreaterThan(0);
    expect((await post("/v1/parcels/search", { country: "CY", identifiers: { municipalityCode: "4000' OR 1=1 --", plot: "666" } })).status).toBe(200);
    const s = await (await api(new Request("http://x/v1/streets?country=CY&q=%CE%B5%CF%81%CE%BC%CE%BF%CF%85"))).json();
    expect(s.streets[0].name).toMatch(/^Ερμού/);
    expect(s.streets[0].center.lat).toBeGreaterThan(34.8);
  });
  it("lists map layers with names and groups", async () => {
    const c = await (await api(new Request("http://x/v1/countries"))).json();
    const layers = c.countries[0].mapLayers as { id: string; role: string; titleKey: string; group: string }[];
    expect(layers.filter((l) => l.role === "basemap").map((l) => l.id)).toEqual(["cy-ortho-2019", "cy-ortho-2014", "cy-ortho-1993", "cy-ortho-1963"]);
    expect(layers.every((l) => l.titleKey && l.group)).toBe(true);
  });
  it("validates the contour box", async () => {
    const get = (q: string) => api(new Request(`http://x/v1/contours?country=CY&bbox=${q}`));
    expect((await get("1,2,3")).status).toBe(400);
    expect((await get("33.6,34.9,33.7,35.0")).status).toBe(400);
  });
  it("finds a plot number inside the visible map and exposes the national grid", async () => {
    const r = await (await post("/v1/parcels/in-box", { country: "CY", plot: "666", bbox: [33.61, 34.925, 33.62, 34.935] })).json();
    expect(r.parcels.length).toBeGreaterThan(0);
    expect((await post("/v1/parcels/in-box", { country: "CY", plot: "666", bbox: [32, 34, 34, 36] })).status).toBe(400);
    expect((await post("/v1/parcels/in-box", { country: "CY", plot: "", bbox: [33.61, 34.925, 33.62, 34.935] })).status).toBe(400);
    const c = await (await api(new Request("http://x/v1/countries"))).json();
    expect(c.countries[0].nationalGrid.epsg).toBe(6312);
  });
});
