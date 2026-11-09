// Supabase Edge Function (Deno). Same handler as the Node dev server.
// Deploy: supabase functions deploy api --no-verify-jwt   (phase 4 adds auth)
// Secrets (server only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), DLS_API_TOKEN (phase 2), ALLOWED_ORIGINS
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
