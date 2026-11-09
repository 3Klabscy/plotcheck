// Paid access: who may see the full analysis of a plot, and the payment flows that grant it.
//
// - Users are identified by their Supabase access token (Authorization: Bearer …), checked against
//   Supabase Auth; access is read with the service role (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
// - Stripe (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET): Checkout for subscriptions and one-off
//   reports, webhook for the result, customer portal to manage/cancel.
// - JCC (JCC_GATEWAY_URL, JCC_USERNAME, JCC_PASSWORD): one-off report payments through the JCC
//   payment gateway's REST API (register.do → hosted page → getOrderStatusExtended.do on return).
//   Written to the gateway's published REST interface; NOT yet tested against JCC — needs the
//   merchant's test credentials. Subscriptions are offered through Stripe only.
// Nothing here is Cyprus-specific; secrets are server-side environment variables only.

export interface BillingEnv {
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
}

export class BillingError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export interface Plan {
  id: string;
  kind: "subscription" | "report";
  name: Record<string, string>;
  description: Record<string, string>;
  price_cents: number;
  currency: string;
  interval: "month" | "year" | null;
  stripe_price_id: string | null;
}

export interface AccessInfo {
  /** Billing is configured on this server; when false everything is open (development). */
  enabled: boolean;
  signedIn: boolean;
  full: boolean;
  subscription?: { plan_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean };
  unlocked: boolean;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Stripe webhook signature (t=…,v1=…): HMAC-SHA256 of "t.payload", 5-minute tolerance. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts["t"]);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || sigs.length === 0 || Math.abs(nowS - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)));
  return sigs.some((s) => s.length === expected.length && [...s].every((c, i) => c === expected[i]));
}

/** Form-encode nested params the way the Stripe API expects (a[b][c]=…). */
export function stripeForm(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? out.push(...stripeForm(item as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === "object") out.push(...stripeForm(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export function createBilling({ fetch: f, env }: BillingEnv) {
  const sbUrl = env("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = env("STRIPE_SECRET_KEY");
  const jccUrl = env("JCC_GATEWAY_URL")?.replace(/\/$/, "");
  const appUrl = (env("APP_URL") ?? "http://localhost:8081").replace(/\/$/, "");
  const apiPublicUrl = env("API_PUBLIC_URL")?.replace(/\/$/, "");
  const enabled = !!(sbUrl && serviceKey);
  const providers = { stripe: !!stripeKey, jcc: !!(jccUrl && env("JCC_USERNAME") && env("JCC_PASSWORD")) };

  // ---------- Supabase (service role) ----------
  async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await f(`${sbUrl}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers as Record<string, string>) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`db ${res.status}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  const tokenCache = new Map<string, { id: string; email?: string; until: number }>();
  /** The signed-in user behind a request, or undefined. */
  async function userOf(req: Request): Promise<{ id: string; email?: string } | undefined> {
    if (!enabled) return undefined;
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || token.split(".").length !== 3) return undefined;
    const hit = tokenCache.get(token);
    if (hit && hit.until > Date.now()) return hit;
    const res = await f(`${sbUrl}/auth/v1/user`, { headers: { apikey: serviceKey!, Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const u = (await res.json()) as { id: string; email?: string };
    const v = { id: u.id, ...(u.email ? { email: u.email } : {}), until: Date.now() + 60_000 };
    tokenCache.set(token, v);
    if (tokenCache.size > 5000) tokenCache.clear();
    return v;
  }

  async function access(req: Request, country?: string, ref?: string): Promise<AccessInfo> {
    if (!enabled) return { enabled: false, signedIn: false, full: true, unlocked: false };
    const user = await userOf(req);
    if (!user) return { enabled: true, signedIn: false, full: false, unlocked: false };
    const [subs, unl] = await Promise.all([
      db<AccessInfo["subscription"][]>(`subscriptions?user_id=eq.${user.id}&status=in.(active,trialing,past_due)&select=plan_id,status,current_period_end,cancel_at_period_end&order=current_period_end.desc.nullslast&limit=1`),
      country && ref ? db<unknown[]>(`unlocks?user_id=eq.${user.id}&country_code=eq.${encodeURIComponent(country)}&national_ref=eq.${encodeURIComponent(ref)}&select=id&limit=1`) : Promise.resolve([]),
    ]);
    const sub = subs[0];
    const subOk = !!sub && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now() - 3 * 86_400_000);
    return { enabled: true, signedIn: true, full: subOk || unl.length > 0, ...(sub ? { subscription: sub } : {}), unlocked: unl.length > 0 };
  }

  async function plans(): Promise<Plan[]> {
    if (!enabled) return [];
    return db<Plan[]>("plans?active=eq.true&select=id,kind,name,description,price_cents,currency,interval,stripe_price_id&order=sort");
  }

  // ---------- Stripe ----------
  async function stripe<T>(path: string, params: Record<string, unknown> = {}, method = "POST"): Promise<T> {
    const body = stripeForm(params).join("&");
    const res = await f(`https://api.stripe.com/v1/${path}${method === "GET" && body ? `?${body}` : ""}`, {
      method,
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" },
      ...(method === "POST" ? { body } : {}),
    });
    const data = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new BillingError(502, `stripe: ${data.error?.message ?? res.status}`);
    return data;
  }

  async function stripeCustomerFor(user: { id: string; email?: string }): Promise<string> {
    const rows = await db<{ provider_customer_id: string | null }[]>(`subscriptions?user_id=eq.${user.id}&provider=eq.stripe&provider_customer_id=not.is.null&select=provider_customer_id&limit=1`);
    if (rows[0]?.provider_customer_id) return rows[0].provider_customer_id;
    const found = user.email ? await stripe<{ data: { id: string }[] }>("customers/search", { query: `metadata['user_id']:'${user.id}'` }, "GET").catch(() => ({ data: [] })) : { data: [] };
    if (found.data[0]) return found.data[0].id;
    const c = await stripe<{ id: string }>("customers", { email: user.email, metadata: { user_id: user.id } });
    return c.id;
  }

  /** Start a payment; returns the provider's page to send the user to. */
  async function checkout(req: Request, b: Record<string, unknown>): Promise<{ url: string }> {
    if (!enabled) throw new BillingError(404, "billing_disabled");
    const user = await userOf(req);
    if (!user) throw new BillingError(401, "sign_in_required");
    const planId = String(b["plan"] ?? "");
    const provider = String(b["provider"] ?? "stripe") as "stripe" | "jcc";
    const plan = (await plans()).find((p) => p.id === planId);
    if (!plan) throw new BillingError(400, "unknown_plan");
    const country = typeof b["country"] === "string" ? b["country"] : undefined;
    const ref = typeof b["nationalRef"] === "string" && b["nationalRef"].length <= 60 ? b["nationalRef"] : undefined;
    if (plan.kind === "report" && (!country || !ref)) throw new BillingError(400, "plot_required");
    const back = `${appUrl}/${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
    const sep = back.includes("?") ? "&" : "?";

    if (provider === "stripe") {
      if (!providers.stripe) throw new BillingError(400, "provider_unavailable");
      const customer = await stripeCustomerFor(user);
      const meta = { user_id: user.id, plan_id: plan.id, ...(country ? { country } : {}), ...(ref ? { national_ref: ref } : {}) };
      const line =
        plan.stripe_price_id
          ? { price: plan.stripe_price_id, quantity: 1 }
          : {
              quantity: 1,
              price_data: {
                currency: plan.currency.toLowerCase(),
                unit_amount: plan.price_cents,
                product_data: { name: plan.name["el"] ?? plan.id + (ref ? ` — ${ref}` : "") },
                ...(plan.interval ? { recurring: { interval: plan.interval } } : {}),
              },
            };
      const s = await stripe<{ url: string }>("checkout/sessions", {
        mode: plan.kind === "subscription" ? "subscription" : "payment",
        customer,
        client_reference_id: user.id,
        line_items: [line],
        metadata: meta,
        ...(plan.kind === "subscription" ? { subscription_data: { metadata: meta } } : { payment_intent_data: { metadata: meta } }),
        automatic_tax: { enabled: env("STRIPE_AUTOMATIC_TAX") === "1" },
        allow_promotion_codes: true,
        locale: env("STRIPE_LOCALE") ?? "auto",
        success_url: `${back}${sep}paid=1`,
        cancel_url: `${back}${sep}paid=0`,
      });
      return { url: s.url };
    }

    if (provider === "jcc") {
      if (!providers.jcc) throw new BillingError(400, "provider_unavailable");
      if (plan.kind !== "report") throw new BillingError(400, "jcc_one_off_only");
      const order = (await db<{ id: string }[]>("payment_orders", {
        method: "POST",
        body: JSON.stringify({ user_id: user.id, plan_id: plan.id, provider: "jcc", country_code: country, national_ref: ref, amount_cents: plan.price_cents, currency: plan.currency }),
      }))[0]!;
      const returnUrl = `${apiPublicUrl ?? appUrl}/v1/billing/jcc/return?order=${order.id}`;
      const params = new URLSearchParams({
        userName: env("JCC_USERNAME")!,
        password: env("JCC_PASSWORD")!,
        orderNumber: order.id.replace(/-/g, "").slice(0, 32),
        amount: String(plan.price_cents),
        currency: plan.currency === "EUR" ? "978" : plan.currency,
        returnUrl,
        failUrl: returnUrl,
        description: `${plan.name["el"] ?? plan.id} ${ref ?? ""}`.slice(0, 99),
        language: env("JCC_LANGUAGE") ?? "el",
      });
      const res = await f(`${jccUrl}/register.do`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
      const r = (await res.json()) as { orderId?: string; formUrl?: string; errorCode?: string; errorMessage?: string };
      if (!r.orderId || !r.formUrl) throw new BillingError(502, `jcc: ${r.errorMessage ?? r.errorCode ?? res.status}`);
      await db(`payment_orders?id=eq.${order.id}`, { method: "PATCH", body: JSON.stringify({ provider_order_id: r.orderId }) });
      return { url: r.formUrl };
    }
    throw new BillingError(400, "unknown_provider");
  }

  /** Customer portal (Stripe): change card, see invoices, cancel. */
  async function portal(req: Request): Promise<{ url: string }> {
    if (!enabled || !providers.stripe) throw new BillingError(404, "billing_disabled");
    const user = await userOf(req);
    if (!user) throw new BillingError(401, "sign_in_required");
    const s = await stripe<{ url: string }>("billing_portal/sessions", { customer: await stripeCustomerFor(user), return_url: `${appUrl}/` });
    return { url: s.url };
  }

  // ---------- webhook (Stripe) ----------
  async function once(provider: string, eventId: string): Promise<boolean> {
    const res = await f(`${sbUrl}/rest/v1/payment_events`, {
      method: "POST",
      headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ provider, event_id: eventId }),
    });
    const rows = (await res.json().catch(() => [])) as unknown[];
    return res.ok && rows.length > 0;
  }

  type StripeSub = { id: string; customer: string; status: string; current_period_end?: number; cancel_at_period_end?: boolean; metadata?: Record<string, string>; items?: { data: { current_period_end?: number }[] } };

  async function upsertStripeSubscription(s: StripeSub) {
    const userId = s.metadata?.["user_id"], planId = s.metadata?.["plan_id"];
    if (!userId || !planId) return;
    const end = s.current_period_end ?? s.items?.data[0]?.current_period_end;
    const status = ["active", "trialing", "past_due", "canceled", "incomplete", "unpaid"].includes(s.status) ? s.status : "incomplete";
    await db("subscriptions?on_conflict=provider_subscription_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ user_id: userId, plan_id: planId, provider: "stripe", provider_customer_id: s.customer, provider_subscription_id: s.id, status, current_period_end: end ? new Date(end * 1000).toISOString() : null, cancel_at_period_end: !!s.cancel_at_period_end }),
    });
  }

  async function grantUnlock(userId: string, country: string, ref: string, provider: "stripe" | "jcc", paymentId: string, amount?: number, currency?: string) {
    await db("unlocks?on_conflict=user_id,country_code,national_ref", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ user_id: userId, country_code: country, national_ref: ref, provider, provider_payment_id: paymentId, amount_cents: amount ?? null, currency: currency?.toUpperCase() ?? null }),
    });
  }

  async function stripeWebhook(req: Request): Promise<{ received: true }> {
    const secret = env("STRIPE_WEBHOOK_SECRET");
    if (!enabled || !secret) throw new BillingError(404, "billing_disabled");
    const payload = await req.text();
    if (!(await verifyStripeSignature(payload, req.headers.get("Stripe-Signature"), secret))) throw new BillingError(400, "bad_signature");
    const ev = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
    if (!(await once("stripe", ev.id))) return { received: true }; // already handled
    const o = ev.data.object;
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
      const meta = (o["metadata"] ?? {}) as Record<string, string>;
      if (o["mode"] === "payment" && o["payment_status"] === "paid" && meta["user_id"] && meta["country"] && meta["national_ref"]) {
        await grantUnlock(meta["user_id"], meta["country"], meta["national_ref"], "stripe", String(o["payment_intent"] ?? o["id"]), Number(o["amount_total"]), String(o["currency"] ?? ""));
      }
      if (o["mode"] === "subscription" && o["subscription"]) {
        await upsertStripeSubscription(await stripe<StripeSub>(`subscriptions/${o["subscription"]}`, {}, "GET"));
      }
    } else if (ev.type.startsWith("customer.subscription.")) {
      await upsertStripeSubscription(o as unknown as StripeSub);
    }
    return { received: true };
  }

  // ---------- JCC return ----------
  async function jccReturn(url: URL): Promise<{ redirect: string }> {
    if (!enabled || !providers.jcc) throw new BillingError(404, "billing_disabled");
    const orderId = url.searchParams.get("order") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(orderId)) throw new BillingError(400, "bad_order");
    const order = (await db<{ id: string; user_id: string; country_code: string; national_ref: string; provider_order_id: string; amount_cents: number; currency: string; status: string }[]>(`payment_orders?id=eq.${orderId}&select=*`))[0];
    if (!order?.provider_order_id) throw new BillingError(404, "bad_order");
    const back = (ok: boolean) => ({ redirect: `${appUrl}/?ref=${encodeURIComponent(order.national_ref)}&paid=${ok ? 1 : 0}` });
    if (order.status === "paid") return back(true);
    const params = new URLSearchParams({ userName: env("JCC_USERNAME")!, password: env("JCC_PASSWORD")!, orderId: order.provider_order_id });
    const res = await f(`${jccUrl}/getOrderStatusExtended.do`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
    const st = (await res.json()) as { orderStatus?: number; amount?: number; errorCode?: string };
    // orderStatus 2 = amount deposited (paid); the amount must match the order
    const paid = st.orderStatus === 2 && Number(st.amount) === order.amount_cents;
    await db(`payment_orders?id=eq.${order.id}`, { method: "PATCH", body: JSON.stringify({ status: paid ? "paid" : "failed" }) });
    if (paid) await grantUnlock(order.user_id, order.country_code, order.national_ref, "jcc", order.provider_order_id, order.amount_cents, order.currency);
    return back(paid);
  }

  return { enabled, providers, access, plans, checkout, portal, stripeWebhook, jccReturn, userOf };
}
