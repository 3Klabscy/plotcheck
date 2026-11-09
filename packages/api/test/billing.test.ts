import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { basicOnly, createApi, MemoryCache, stripeForm, verifyStripeSignature } from "../src/index.ts";
import { cyprus } from "@plotcheck/country-cy";

const enc = new TextEncoder();
async function sign(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${sig}`;
}

describe("billing helpers", () => {
  it("verifies Stripe webhook signatures (and rejects tampering and old events)", async () => {
    const body = '{"id":"evt_1"}';
    expect(await verifyStripeSignature(body, await sign(body, "whsec_x"), "whsec_x")).toBe(true);
    expect(await verifyStripeSignature(body + " ", await sign(body, "whsec_x"), "whsec_x")).toBe(false);
    expect(await verifyStripeSignature(body, await sign(body, "other"), "whsec_x")).toBe(false);
    expect(await verifyStripeSignature(body, await sign(body, "whsec_x", 1000), "whsec_x")).toBe(false);
    expect(await verifyStripeSignature(body, null, "whsec_x")).toBe(false);
  });
  it("form-encodes nested Stripe parameters", () => {
    expect(stripeForm({ mode: "payment", line_items: [{ quantity: 1, price_data: { unit_amount: 1900 } }], metadata: { a: "b c" } })).toEqual([
      "mode=payment", "line_items%5B0%5D%5Bquantity%5D=1", "line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1900", "metadata%5Ba%5D=b%20c",
    ]);
  });
  it("leaves the relaxations' details out of the free tier, keeping a preview", () => {
    const r = basicOnly({ use: "house", relaxed: { figures: { achievableGfaM2: 1131, feasibleFloors: 4 }, units: { total: 11 }, gain: { gfaM2: 293 } } } as never);
    expect(r).not.toHaveProperty("relaxed");
    expect(r.relaxedPreview).toEqual({ gfaM2: 1131, floors: 4, units: 11, gainM2: 293 });
  });
});

// ---------- against a running Supabase (local stack), Stripe simulated ----------
const url = process.env["SUPABASE_TEST_URL"], anon = process.env["SUPABASE_TEST_ANON_KEY"], service = process.env["SUPABASE_TEST_SERVICE_KEY"];

describe.runIf(!!(url && anon && service))("paid access end to end (Supabase + simulated Stripe)", () => {
  const fx = (n: string) => readFileSync(new URL(`../../countries/cy/test/fixtures/${n}`, import.meta.url), "utf8");
  const stripeCalls: { url: string; body: string }[] = [];
  const fetchMix = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.startsWith(url!)) return fetch(input, init);
    if (u.startsWith("https://api.stripe.com/")) {
      stripeCalls.push({ url: u, body: String(init?.body ?? "") });
      if (u.includes("/customers/search")) return new Response(JSON.stringify({ data: [] }));
      if (u.endsWith("/customers")) return new Response(JSON.stringify({ id: "cus_test" }));
      if (u.endsWith("/checkout/sessions")) return new Response(JSON.stringify({ id: "cs_test", url: "https://checkout.stripe.com/c/pay/cs_test" }));
      return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 400 });
    }
    if (/MapServer\/1\/query/.test(u)) return new Response(fx("rest-query-bbox.geojson"));
    if (/GetFeatureInfo/.test(u)) return new Response(fx("wms-gfi-ka4.xml"));
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  const env: Record<string, string> = { SUPABASE_URL: url!, SUPABASE_SERVICE_ROLE_KEY: service!, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_test", APP_URL: "http://localhost:8081" };
  const api = createApi({ fetch: fetchMix, env: (k) => env[k], cache: new MemoryCache(), countries: [cyprus] });
  let adminClient: ReturnType<typeof createClient> | undefined;
  const admin = () => (adminClient ??= createClient(url!, service!, { auth: { persistSession: false } }));
  const REF = "4000-40/56W1-3-1-666";

  async function user(name: string) {
    const email = `${name}.${Date.now()}@example.test`, password = `pw-${Date.now()}!`;
    await admin().auth.admin.createUser({ email, password, email_confirm: true });
    const c = createClient(url!, anon!, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password });
    return { c, id: s.data.user!.id, token: s.data.session!.access_token };
  }
  const call = (path: string, init: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) =>
    api(new Request(`http://x${path}`, {
      method: init.body !== undefined || init.raw !== undefined ? "POST" : "GET",
      headers: { "content-type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...init.headers },
      ...(init.raw !== undefined ? { body: init.raw } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }));

  it("free tier → report purchase unlocks the plot → subscription unlocks all", async () => {
    const plans = await (await call("/v1/billing/plans")).json();
    expect(plans.plans.map((p: { id: string }) => p.id)).toEqual(["report", "pro-monthly", "pro-yearly"]);
    expect(plans.providers).toEqual({ stripe: true, jcc: false });

    // anonymous and new users get the basic analysis only
    const anonA = await (await call("/v1/analyse", { body: { country: "CY", nationalRef: REF, use: "all" } })).json();
    expect(anonA.access).toEqual({ full: false, signedIn: false, billing: true });
    expect(anonA.finance).toBeUndefined();
    expect(anonA.results.every((r: Record<string, unknown>) => !("relaxed" in r))).toBe(true);

    const u = await user("eleni");
    expect((await call("/v1/billing/checkout", { body: { plan: "report", provider: "stripe", country: "CY", nationalRef: REF } })).status).toBe(401);
    expect((await call("/v1/billing/checkout", { token: u.token, body: { plan: "report", provider: "stripe" } })).status).toBe(400);
    expect((await call("/v1/billing/checkout", { token: u.token, body: { plan: "report", provider: "jcc", country: "CY", nationalRef: REF } })).status).toBe(400);
    const co = await (await call("/v1/billing/checkout", { token: u.token, body: { plan: "report", provider: "stripe", country: "CY", nationalRef: REF } })).json();
    expect(co.url).toContain("checkout.stripe.com");
    const sess = decodeURIComponent(stripeCalls.find((c) => c.url.endsWith("/checkout/sessions"))!.body);
    expect(sess).toContain("mode=payment");
    expect(sess).toContain(`metadata[user_id]=${u.id}`);
    expect(sess).toContain("line_items[0][price_data][unit_amount]=1900");

    // saving needs access
    expect((await u.c.from("saved_plots").insert({ country_code: "CY", national_ref: REF })).error).not.toBeNull();

    // Stripe confirms the payment (signed webhook) → plot unlocked
    const paid = JSON.stringify({ id: `evt_pay_${Date.now()}`, type: "checkout.session.completed", data: { object: { id: "cs_test", mode: "payment", payment_status: "paid", payment_intent: `pi_${Date.now()}`, amount_total: 1900, currency: "eur", metadata: { user_id: u.id, plan_id: "report", country: "CY", national_ref: REF } } } });
    expect((await call("/v1/billing/webhook/stripe", { raw: paid, headers: { "Stripe-Signature": "t=1,v1=bad" } })).status).toBe(400);
    expect((await call("/v1/billing/webhook/stripe", { raw: paid, headers: { "Stripe-Signature": await sign(paid, "whsec_test") } })).status).toBe(200);
    expect((await call("/v1/billing/webhook/stripe", { raw: paid, headers: { "Stripe-Signature": await sign(paid, "whsec_test") } })).status).toBe(200); // retry is harmless

    const acc = await (await call(`/v1/me/access?country=CY&ref=${encodeURIComponent(REF)}`, { token: u.token })).json();
    expect(acc).toMatchObject({ full: true, unlocked: true, signedIn: true });
    const full = await (await call("/v1/analyse", { token: u.token, body: { country: "CY", nationalRef: REF, use: "all" } })).json();
    expect(full.access.full).toBe(true);
    expect(full.finance).toBeDefined();
    expect((await u.c.from("saved_plots").insert({ country_code: "CY", national_ref: REF })).error).toBeNull();
    // …but not another plot
    expect((await (await call(`/v1/me/access?country=CY&ref=other`, { token: u.token })).json()).full).toBe(false);
    expect((await u.c.from("unlocks").select("national_ref")).data).toEqual([{ national_ref: REF }]);
    // users cannot grant themselves access
    expect((await u.c.from("unlocks").insert({ user_id: u.id, country_code: "CY", national_ref: "free", provider: "manual" })).error).not.toBeNull();

    // a subscription opens every plot; cancelling closes them again
    const v = await user("vasos");
    const subEvent = (status: string) => JSON.stringify({ id: `evt_sub_${status}_${Date.now()}`, type: "customer.subscription.updated", data: { object: { id: `sub_${v.id.slice(0, 8)}`, customer: "cus_v", status, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: false, metadata: { user_id: v.id, plan_id: "pro-monthly" } } } });
    let ev = subEvent("active");
    await call("/v1/billing/webhook/stripe", { raw: ev, headers: { "Stripe-Signature": await sign(ev, "whsec_test") } });
    expect((await (await call(`/v1/me/access?country=CY&ref=anything`, { token: v.token })).json()).full).toBe(true);
    ev = subEvent("canceled");
    await call("/v1/billing/webhook/stripe", { raw: ev, headers: { "Stripe-Signature": await sign(ev, "whsec_test") } });
    expect((await (await call(`/v1/me/access?country=CY&ref=anything`, { token: v.token })).json()).full).toBe(false);

    await admin().auth.admin.deleteUser(u.id);
    await admin().auth.admin.deleteUser(v.id);
  }, 60_000);
});
