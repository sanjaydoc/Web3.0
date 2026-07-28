import { type Web3Id, web3Id } from '@web3/core';
import { fromB64u, hashJson, signString, verifyString } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';

/**
 * Proof-of-Contribution — the engine that lets a plain node (not just an authority) earn aETH for
 * lending uptime and compute to the network.
 *
 * Each node periodically signs a small **contribution report** (how long it's been up, how many
 * agents it hosts, how many requests it has served) with its node key and gossips it to peers. Every
 * node collects the reports it hears into a registry. Once per epoch the block proposer splits a
 * fixed reward pool across the currently-live nodes, weighted by their contribution score and capped
 * per node — minting the split INTO the block, so every node's ledger converges on the same payouts.
 *
 * Sybil stance: the pool is FIXED and split PROPORTIONALLY with a per-node cap, so spinning up fake
 * nodes only dilutes the honest share — it never mints new money. Eligibility needs a fresh,
 * node-signed heartbeat. Stronger proof-of-resource (stake-weighting, bandwidth challenges) is the
 * documented follow-on; see docs.
 */

/** The signed body of a heartbeat — what a node claims it is contributing, at time `ts`. */
export interface ContributionReport {
  /** base64url ML-DSA node public key — the contributor's identity (and signer). */
  nodeKey: string;
  /** Seconds this node process has been up. */
  uptimeSec: number;
  /** Agents this node is currently hosting. */
  agentsHosted: number;
  /** Requests/txs this node has served (monotonic counter). */
  txServed: number;
  /** Cumulative agents EVER registered on this node's ledger (idle + online), treasury excluded.
   *  Optional so pre-this-field nodes hash/verify identically; the aggregator falls back to a
   *  treasury-adjusted `agentsHosted` for nodes that don't report it. Powers "Total agents". */
  agentsTotal?: number;
  /** Epoch-ms the report was produced (freshness + replay window). */
  ts: number;
  /** Optional opt-in geo position so this node appears on every peer's Network map (not just its
   *  own). Only present when the operator saved a location; signed as part of the report. */
  lat?: number;
  lon?: number;
  label?: string;
}

/** A gossiped heartbeat: the report plus the node's signature over its canonical hash. */
export interface Heartbeat {
  report: ContributionReport;
  /** base64url ML-DSA signature by `report.nodeKey` over `hashJson(report)`. */
  signature: string;
}

/** A stored contributor: its latest report and when we last heard from it (local clock). */
interface ContributionEntry {
  report: ContributionReport;
  lastSeen: number;
}

/** Weights turning a raw report into a single comparable contribution score. */
export interface ContributionWeights {
  /** Per hour of uptime. */
  uptime: number;
  /** Per hosted agent. */
  host: number;
  /** Per served request/tx. */
  relay: number;
}

/** One node's share of an epoch's reward pool. */
export interface RewardShare {
  nodeKey: string;
  /** The per-node wallet the reward is minted into (derived from `nodeKey`). */
  wallet: Web3Id;
  amount: number;
  /** The weighted contribution score this share was computed from (for display/audit). */
  score: number;
}

/** The canonical message a node signs / verifies for a report — sorted-key JSON hash. */
export function hashReport(report: ContributionReport): string {
  // Location fields are hashed ONLY when present, so a report without them hashes identically to the
  // pre-location format — older nodes' signatures still verify, and adding a location doesn't break
  // interop during a rolling upgrade.
  const body: Record<string, unknown> = {
    nodeKey: report.nodeKey,
    uptimeSec: report.uptimeSec,
    agentsHosted: report.agentsHosted,
    txServed: report.txServed,
    ts: report.ts,
  };
  if (typeof report.lat === 'number') body.lat = report.lat;
  if (typeof report.lon === 'number') body.lon = report.lon;
  if (report.label) body.label = report.label;
  // Hashed only when present so a report without it hashes identically to the pre-field format —
  // older nodes' signatures still verify during a rolling upgrade (same rule as the location fields).
  if (typeof report.agentsTotal === 'number') body.agentsTotal = report.agentsTotal;
  return hashJson(body);
}

/** Sign a contribution report with the node keypair, producing a gossippable heartbeat. */
export function signHeartbeat(keys: Keypair, report: ContributionReport): Heartbeat {
  return { report, signature: signString(keys.secretKey, hashReport(report)) };
}

/**
 * The per-node reward wallet, derived deterministically from the node key. Every node — including
 * remote proposers that never saw this operator's account — computes the SAME destination, so
 * contribution rewards are attributable to the exact node that earned them (unlike the shared node
 * treasury). The operator collects from it in the console.
 */
export function nodeRewardWalletId(nodeKey: string): Web3Id {
  return web3Id(`noderwd-${hashJson(nodeKey).slice(0, 16)}`);
}

/**
 * The network-wide contribution-pool wallet. Fee slices (1% of each payment/hosting fee) are paid
 * here from real activity — NOT minted — and split across contributing nodes by score each epoch.
 * A single shared address on the replicated ledger, so every node feeds and reads the same pool.
 */
export const CONTRIBUTION_POOL_ID: Web3Id = web3Id('contribution-pool');

/** A non-negative integer, or the fallback — guards against NaN/negatives in reports. */
function safeCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export class ContributionService {
  private readonly entries = new Map<string, ContributionEntry>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    /** Max age of a report's `ts` before it's rejected as stale (ms). */
    private readonly freshnessMs = 300_000, // 5 minutes
    /** How far in the future a report's `ts` may be dated (clock skew, ms). */
    private readonly clockSkewMs = 10_000,
  ) {}

  /**
   * Ingest a gossiped heartbeat. Verifies the node's signature, rejects stale or future-dated
   * reports, and keeps only the newest report per node. Returns whether it was accepted AND newer
   * than what we held (so callers can decide whether to re-gossip).
   */
  ingest(hb: Heartbeat): boolean {
    const report = hb?.report;
    if (!report || typeof report.nodeKey !== 'string' || report.nodeKey.length < 32) return false;
    if (typeof report.ts !== 'number' || !Number.isFinite(report.ts)) return false;
    const now = this.now();
    if (report.ts > now + this.clockSkewMs) return false; // future-dated
    if (report.ts < now - this.freshnessMs) return false; // stale
    // Verify the report was signed by the key it claims to be.
    let ok = false;
    try {
      ok = verifyString(fromB64u(report.nodeKey), hashReport(report), hb.signature);
    } catch {
      return false;
    }
    if (!ok) return false;
    // Normalise the counters so a malformed report can't poison the score maths. The opt-in location
    // (already covered by the verified signature) is kept as-is so the node shows on peers' maps.
    const hasLoc =
      typeof report.lat === 'number' &&
      Number.isFinite(report.lat) &&
      typeof report.lon === 'number' &&
      Number.isFinite(report.lon);
    const clean: ContributionReport = {
      nodeKey: report.nodeKey,
      uptimeSec: safeCount(report.uptimeSec),
      agentsHosted: safeCount(report.agentsHosted),
      txServed: safeCount(report.txServed),
      ts: report.ts,
      ...(typeof report.agentsTotal === 'number'
        ? { agentsTotal: safeCount(report.agentsTotal) }
        : {}),
      ...(hasLoc
        ? {
            lat: report.lat,
            lon: report.lon,
            ...(report.label ? { label: String(report.label).slice(0, 48) } : {}),
          }
        : {}),
    };
    const existing = this.entries.get(clean.nodeKey);
    if (existing && existing.report.ts >= clean.ts) {
      existing.lastSeen = now; // still live, just not newer
      return false;
    }
    this.entries.set(clean.nodeKey, { report: clean, lastSeen: now });
    return true;
  }

  /** Drop contributors not heard from within `windowMs` (default: the freshness window). */
  prune(windowMs = this.freshnessMs): void {
    const cutoff = this.now() - windowMs;
    for (const [key, entry] of this.entries) {
      if (entry.lastSeen < cutoff) this.entries.delete(key);
    }
  }

  /** Contributors heard from within `windowMs`, newest-report data. */
  live(windowMs = this.freshnessMs): ContributionReport[] {
    const cutoff = this.now() - windowMs;
    const out: ContributionReport[] = [];
    for (const entry of this.entries.values()) {
      if (entry.lastSeen >= cutoff) out.push(entry.report);
    }
    return out;
  }

  /** Number of currently-live contributors (within the freshness window). */
  get size(): number {
    return this.live().length;
  }

  /**
   * Network-wide agent count: the sum of `agentsHosted` across all live nodes. Each node advertises
   * its own `registry.size` in its heartbeat and every node (including itself) is one entry here, so
   * this is the total number of agents hosted anywhere on the network — what the admin sees in
   * Overview / Network, versus a single node's local `registry.size`.
   */
  totalAgents(windowMs = this.freshnessMs): number {
    return this.live(windowMs).reduce((sum, r) => sum + r.agentsHosted, 0);
  }

  /**
   * Network-wide online-agent count: the sum of each live node's connected-agent figure (carried in
   * the report's `txServed` field, which a node sets to its `connections.online()` count). The
   * network-wide analogue of a single node's `online` stat.
   */
  totalOnline(windowMs = this.freshnessMs): number {
    return this.live(windowMs).reduce((sum, r) => sum + r.txServed, 0);
  }

  /**
   * Network-wide CUMULATIVE agent count — every agent ever registered on any live node's ledger
   * (idle + online), treasury excluded. This is "Total agents" in the admin Overview, the
   * created-to-date analogue of the live `totalAgents()`. A node that reports `agentsTotal` (its own
   * treasury-excluded ledger register-count) contributes it directly; an older node that predates the
   * field falls back to its live `agentsHosted` minus its one treasury card, so it still counts.
   * Only LIVE nodes contribute — a node whose agents are all offline drops out until it re-heartbeats,
   * the same reachability limit as every other network metric (persistent cross-node totals need
   * agent-card replication, the documented follow-on).
   */
  totalAgentsEver(windowMs = this.freshnessMs): number {
    return this.live(windowMs).reduce(
      (sum, r) =>
        sum + (typeof r.agentsTotal === 'number' ? r.agentsTotal : Math.max(0, r.agentsHosted - 1)),
      0,
    );
  }

  /** The weighted contribution score for a single report. */
  static score(report: ContributionReport, weights: ContributionWeights): number {
    const hours = report.uptimeSec / 3_600;
    return (
      hours * weights.uptime + report.agentsHosted * weights.host + report.txServed * weights.relay
    );
  }

  /**
   * Split `pool` (minor units) across live contributors proportional to score, capped per node at
   * `capBps` basis points of the pool. Deterministic and integer-exact: no share exceeds the cap,
   * the total never exceeds the pool, and any rounding dust goes to the top-scoring node so the
   * whole pool is distributed. Returns [] when the engine is off or nobody qualifies.
   */
  distribute(
    pool: number,
    weights: ContributionWeights,
    capBps: number,
    windowMs = this.freshnessMs,
  ): RewardShare[] {
    if (pool <= 0) return [];
    const live = this.live(windowMs)
      .map((report) => ({ report, score: ContributionService.score(report, weights) }))
      .filter((r) => r.score > 0);
    if (live.length === 0) return [];
    const totalScore = live.reduce((s, r) => s + r.score, 0);
    const cap = capBps > 0 ? Math.floor((pool * capBps) / 10_000) : pool;

    // Proportional floor split, capped per node.
    let distributed = 0;
    const shares: RewardShare[] = live
      .map(({ report, score }) => {
        const raw = Math.floor((pool * score) / totalScore);
        const amount = Math.min(raw, cap);
        distributed += amount;
        return {
          nodeKey: report.nodeKey,
          wallet: nodeRewardWalletId(report.nodeKey),
          amount,
          score,
        };
      })
      .filter((s) => s.amount > 0);
    if (shares.length === 0) return [];

    // Hand rounding remainder to the highest score, without breaching its cap.
    let remainder = pool - distributed;
    if (remainder > 0) {
      shares.sort((a, b) => b.score - a.score);
      for (const share of shares) {
        if (remainder <= 0) break;
        const room = cap - share.amount;
        const add = Math.min(room, remainder);
        share.amount += add;
        remainder -= add;
      }
    }
    // Stable order by nodeKey so the block's entries are deterministic across proposers.
    shares.sort((a, b) => (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0));
    return shares;
  }
}
