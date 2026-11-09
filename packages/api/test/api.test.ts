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
