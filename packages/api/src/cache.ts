export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export class MemoryCache implements Cache {
  private m = new Map<string, { v: unknown; exp: number }>();
  constructor(private maxEntries = 5_000) {}
  async get<T>(key: string): Promise<T | undefined> {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.m.delete(key);
      return undefined;
    }
    return e.v as T;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.m.size >= this.maxEntries) this.m.delete(this.m.keys().next().value as string);
    this.m.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
}

/**
 * Postgres-backed cache via Supabase PostgREST (table `source_cache`, see migrations).
 * Uses the service-role key, so it must only ever run server-side (Edge Function).
 */
export class SupabaseCache implements Cache {
  constructor(private url: string, private serviceKey: string, private f: typeof fetch = fetch) {}
  private headers() {
    return { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, "Content-Type": "application/json" };
  }
  async get<T>(key: string): Promise<T | undefined> {
    const q = `${this.url}/rest/v1/source_cache?key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=value`;
    const res = await this.f(q, { headers: this.headers() });
    if (!res.ok) return undefined;
    const rows = (await res.json()) as { value: T }[];
    return rows[0]?.value;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.f(`${this.url}/rest/v1/source_cache?on_conflict=key`, {
      method: "POST",
      headers: { ...this.headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key, value, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString() }),
    });
  }
}

/** Return cached value or compute + store it. Failures are never cached. */
export async function cached<T>(cache: Cache, key: string, ttl: number, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  try {
    const hit = await cache.get<T>(key);
    if (hit !== undefined) return { value: hit, hit: true };
  } catch {
    /* cache outage must not break lookups */
  }
  const value = await compute();
  cache.set(key, value, ttl).catch(() => undefined);
  return { value, hit: false };
}
