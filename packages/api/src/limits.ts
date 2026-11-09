/** Fixed-window-ish token bucket per client key (IP / user). In-memory per instance. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity: number, private refillPerSec: number) {}
  take(key: string, cost = 1): { ok: boolean; retryAfterS: number } {
    const now = Date.now() / 1000;
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.refillPerSec);
    b.at = now;
    if (this.buckets.size > 50_000) this.buckets.clear();
    if (b.tokens >= cost) {
      b.tokens -= cost;
      this.buckets.set(key, b);
      return { ok: true, retryAfterS: 0 };
    }
    this.buckets.set(key, b);
    return { ok: false, retryAfterS: Math.ceil((cost - b.tokens) / this.refillPerSec) };
  }
}

/** Cap concurrent upstream (data-source) requests so we never hammer DLS. */
export function limitConcurrency(f: typeof fetch, max: number): typeof fetch {
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = () => new Promise<void>((res) => (active < max ? (active++, res()) : queue.push(() => (active++, res()))));
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return (async (...args: Parameters<typeof fetch>) => {
    await acquire();
    try {
      return await f(...args);
    } finally {
      release();
    }
  }) as typeof fetch;
}
