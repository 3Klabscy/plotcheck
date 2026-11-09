import type { ProviderContext } from "@plotcheck/country-sdk";

export const DLS_BASE = "https://eservices.dls.moi.gov.cy";
export const DLS_INSPIRE = `${DLS_BASE}/inspire/rest/services/INSPIRE`;

export class DlsError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/**
 * GET a DLS URL with timeout and one retry on network errors / 5xx.
 * DLS_API_TOKEN (server env, phase 2+) is appended as an ArcGIS token when present;
 * the public INSPIRE services used in phase 1 need no token.
 */
export async function dlsGet(ctx: ProviderContext, url: string, timeoutMs = 20_000): Promise<string> {
  const token = ctx.env("DLS_API_TOKEN");
  const full = token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onAbort = () => ac.abort();
    ctx.signal?.addEventListener("abort", onAbort);
    try {
      const res = await ctx.fetch(full, { signal: ac.signal, headers: { Accept: "application/xml,text/xml,*/*" } });
      const body = await res.text();
      if (res.status >= 500) throw new DlsError(`DLS ${res.status}`, res.status);
      if (!res.ok) throw new DlsError(`DLS ${res.status}: ${body.slice(0, 200)}`, res.status);
      if (/<(ows:)?ExceptionReport|<ServiceExceptionReport/.test(body)) {
        const msg = /<(?:ows:)?ExceptionText>([\s\S]*?)<|<ServiceException[^>]*>([\s\S]*?)</.exec(body);
        throw new DlsError(`DLS service exception: ${(msg?.[1] ?? msg?.[2] ?? "").trim()}`);
      }
      return body;
    } catch (e) {
      lastErr = e;
      if (e instanceof DlsError && e.status !== undefined && e.status < 500) throw e;
      if (ctx.signal?.aborted) throw e;
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new DlsError(String(lastErr));
}
