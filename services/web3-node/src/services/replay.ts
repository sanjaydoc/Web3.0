import type { EnvelopeMeta, SignedEnvelope, Web3Id } from '@web3/core';
import { open } from '@web3/core';
import type { AuthConfig } from '../config.js';

export interface AuthOutcome<T> {
  ok: boolean;
  reason?: string;
  payload?: T;
  meta?: EnvelopeMeta;
}

/**
 * Replay & freshness guard for signed envelopes. A valid signature proves *who* sent a request,
 * but not *when* — so a captured envelope could be resubmitted forever. This guard rejects
 * envelopes whose timestamp is stale or in the future, and remembers each nonce until it expires
 * so the same envelope can't be accepted twice.
 *
 * In-memory for the MVP: nonces are forgotten on restart, and the freshness window bounds how long
 * a captured envelope could be replayed after a restart anyway.
 */
export class ReplayGuard {
  /** nonce → epoch-ms after which it may be forgotten. */
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly config: AuthConfig,
    private readonly nowMs: () => number,
  ) {}

  /** Check an envelope's freshness and nonce uniqueness, recording the nonce when it passes. */
  check(meta: EnvelopeMeta): { ok: boolean; reason?: string } {
    const now = this.nowMs();
    const ts = Date.parse(meta.ts);
    if (Number.isNaN(ts)) return { ok: false, reason: 'envelope timestamp is not a valid date' };
    if (ts > now + this.config.clockSkewMs) {
      return { ok: false, reason: 'envelope timestamp is in the future' };
    }
    if (ts < now - this.config.freshnessMs) {
      return { ok: false, reason: `envelope is stale (older than ${this.config.freshnessMs}ms)` };
    }
    this.prune(now);
    if (this.seen.has(meta.nonce)) return { ok: false, reason: 'nonce already used (replay)' };
    this.seen.set(meta.nonce, ts + this.config.freshnessMs + this.config.clockSkewMs);
    return { ok: true };
  }

  private prune(now: number): void {
    for (const [nonce, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(nonce);
    }
  }
}

/**
 * Verify a signed envelope end to end: signature + DID binding (via `open`), an optional pinned
 * signer, and replay/freshness. Returns the decoded payload and meta on success. The caller decides
 * whether to reject (enforce) or merely log (warn-only) a failure.
 */
export function checkEnvelope<T>(
  replay: ReplayGuard,
  env: SignedEnvelope<T>,
  expectedSigner?: Web3Id,
): AuthOutcome<T> {
  const opened = open(env, expectedSigner);
  if (!opened.ok || !opened.payload || !opened.meta) {
    return { ok: false, reason: opened.reason ?? 'invalid envelope' };
  }
  const fresh = replay.check(opened.meta);
  if (!fresh.ok) {
    return { ok: false, reason: fresh.reason, payload: opened.payload, meta: opened.meta };
  }
  return { ok: true, payload: opened.payload, meta: opened.meta };
}
