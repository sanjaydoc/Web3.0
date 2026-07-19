/**
 * A tiny fixed-window rate limiter keyed by an arbitrary string (used per client IP for the HTTP
 * surface). This is a coarse DoS backstop that sits *in front of* the per-agent guardrails: it
 * bounds requests before an agent is even identified, so an unauthenticated flood can't reach the
 * expensive signature-verification paths. In-memory and per-process for the MVP.
 */
export interface RateVerdict {
  ok: boolean;
  count: number;
  limit: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly nowMs: () => number,
  ) {}

  /** Record a hit for `key` and report whether it is within the limit. `limit <= 0` disables it. */
  check(key: string): RateVerdict {
    if (this.limit <= 0) return { ok: true, count: 0, limit: this.limit };
    const now = this.nowMs();
    const window = this.hits.get(key);
    if (!window || window.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true, count: 1, limit: this.limit };
    }
    window.count += 1;
    return { ok: window.count <= this.limit, count: window.count, limit: this.limit };
  }
}
