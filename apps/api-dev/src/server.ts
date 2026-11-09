// Local development server for the API (Node). Production runs the same handler as a
// Supabase Edge Function (supabase/functions/api/index.ts).
import { createServer } from "node:http";
import { createApi, MemoryCache } from "@plotcheck/api";
import { cyprus } from "@plotcheck/country-cy";

const port = Number(process.env.PORT ?? 8787);
const handle = createApi({
  fetch: globalThis.fetch,
  env: (k) => process.env[k],
  cache: new MemoryCache(),
  countries: [cyprus],
});

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("x-forwarded-for", req.socket.remoteAddress ?? "local");
  const request = new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
  const started = Date.now();
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
  console.log(`${req.method} ${req.url} → ${response.status} ${Date.now() - started}ms`);
}).listen(port, () => console.log(`API dev server on http://localhost:${port}/v1/health`));
