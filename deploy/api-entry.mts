// Netlify Function entry: the same API handler as the Node dev server and the Supabase Edge Function.
// Bundled into deploy/netlify/functions/api.mjs by tools/build_netlify.sh.
import { createApi, MemoryCache } from "@plotcheck/api";
import { cyprus } from "@plotcheck/country-cy";

declare const Netlify: { env: { get(k: string): string | undefined } };

const handle = createApi({
  fetch: globalThis.fetch,
  env: (k) => Netlify.env.get(k),
  cache: new MemoryCache(),
  countries: [cyprus],
});

export default async (req: Request) => handle(req);

export const config = { path: "/v1/*", region: "fra" };
