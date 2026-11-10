// Local development server for the API (Node). Production runs the same handler as a
// Supabase Edge Function (supabase/functions/api/index.ts).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createApi, MemoryCache } from "@plotcheck/api";
import { cyprus } from "@plotcheck/country-cy";

const port = Number(process.env.PORT ?? 8787);
const handle = createApi({
  fetch: globalThis.fetch,
  env: (k) => process.env[k],
  cache: new MemoryCache(),
  countries: [cyprus],
});

// Optional: also serve the built web app (STATIC_DIR = output of `expo export --platform web`), so app
// and API share one address — e.g. for a preview. Build the app with EXPO_PUBLIC_API_URL="" for that.
const staticDir = process.env.STATIC_DIR;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2", ".map": "application/json" };

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | undefined> {
  if (!staticDir) return undefined;
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(staticDir, rel), join(staticDir, rel, "index.html"), join(staticDir, `${rel}.html`), join(staticDir, "index.html")]) {
    if (!candidate.startsWith(staticDir)) continue;
    const st = await stat(candidate).catch(() => undefined);
    if (st?.isFile()) return { body: await readFile(candidate), type: TYPES[extname(candidate)] ?? "application/octet-stream" };
  }
  return undefined;
}

createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://x").pathname;
  if (staticDir && (req.method === "GET" || req.method === "HEAD") && !pathname.startsWith("/v1/")) {
    const file = await serveStatic(pathname);
    if (file) {
      res.writeHead(200, { "Content-Type": file.type, "Cache-Control": pathname.startsWith("/_expo/") ? "public, max-age=31536000, immutable" : "no-cache" });
      res.end(req.method === "HEAD" ? undefined : file.body);
      return;
    }
  }
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
