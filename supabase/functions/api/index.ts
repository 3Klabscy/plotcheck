// Supabase Edge Function (Deno). Same handler as the Node dev server.
// Deploy: supabase functions deploy api --no-verify-jwt   (the API checks users' tokens itself;
// payment providers must be able to call the webhooks without one)
// Secrets (server only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), ALLOWED_ORIGINS, APP_URL,
// API_PUBLIC_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, JCC_GATEWAY_URL, JCC_USERNAME,
// JCC_PASSWORD, DLS_API_TOKEN (when issued)
import { createApi, MemoryCache, SupabaseCache } from "@plotcheck/api";
import { cyprus } from "@plotcheck/country-cy";

const env = (k: string) => Deno.env.get(k);
const url = env("SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");

const handle = createApi({
  fetch: globalThis.fetch,
  env,
  cache: url && key ? new SupabaseCache(url, key) : new MemoryCache(),
  countries: [cyprus],
});

Deno.serve(handle);
