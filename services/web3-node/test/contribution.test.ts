import { isValidWeb3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import { describe, expect, it } from 'vitest';
import {
  type ContributionReport,
  ContributionService,
  type ContributionWeights,
  type Heartbeat,
  nodeRewardWalletId,
  signHeartbeat,
} from '../src/services/contribution.js';

const seed = (n: number) => new Uint8Array(32).fill(n);
const WEIGHTS: ContributionWeights = { uptime: 1, host: 2, relay: 1 };

/** A signed heartbeat for a node identified by `seed(n)`, at time `ts`. */
function heartbeat(
  n: number,
  fields: Partial<Omit<ContributionReport, 'nodeKey'>>,
  ts: number,
): { hb: Heartbeat; nodeKey: string } {
  const keys = generateKeypair(seed(n));
  const nodeKey = toB64u(keys.publicKey);
  const report: ContributionReport = {
    nodeKey,
    uptimeSec: fields.uptimeSec ?? 0,
    agentsHosted: fields.agentsHosted ?? 0,
    txServed: fields.txServed ?? 0,
    ts,
    ...(fields.lat !== undefined ? { lat: fields.lat } : {}),
    ...(fields.lon !== undefined ? { lon: fields.lon } : {}),
    ...(fields.label !== undefined ? { label: fields.label } : {}),
  };
  return { hb: signHeartbeat(keys, report), nodeKey };
}

describe('ContributionService — ingest & verification', () => {
  it('accepts a fresh, correctly-signed heartbeat', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    const { hb } = heartbeat(1, { uptimeSec: 3_600 }, t);
    expect(svc.ingest(hb)).toBe(true);
    expect(svc.size).toBe(1);
  });

  it('rejects a tampered report (signature no longer matches)', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    const { hb } = heartbeat(1, { uptimeSec: 3_600 }, t);
    hb.report.uptimeSec = 999_999; // inflate contribution after signing
    expect(svc.ingest(hb)).toBe(false);
    expect(svc.size).toBe(0);
  });

  it('accepts an opt-in location and retains it for the map', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    const { hb } = heartbeat(1, { uptimeSec: 3_600, lat: 13.0827, lon: 80.2707, label: 'Chennai' }, t);
    expect(svc.ingest(hb)).toBe(true);
    const live = svc.live();
    expect(live[0]?.lat).toBe(13.0827);
    expect(live[0]?.lon).toBe(80.2707);
    expect(live[0]?.label).toBe('Chennai');
  });

  it('rejects a heartbeat whose location was moved after signing', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    const { hb } = heartbeat(1, { uptimeSec: 3_600, lat: 13.08, lon: 80.27 }, t);
    hb.report.lat = 51.5; // relocate the pin after signing → signature must fail
    expect(svc.ingest(hb)).toBe(false);
  });

  it('rejects a heartbeat signed by a different key than it claims', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    const impostor = generateKeypair(seed(9));
    const victim = generateKeypair(seed(1));
    const report: ContributionReport = {
      nodeKey: toB64u(victim.publicKey), // claim to be the victim
      uptimeSec: 3_600,
      agentsHosted: 0,
      txServed: 0,
      ts: t,
    };
    const forged = signHeartbeat(impostor, report); // but sign with the impostor key
    expect(svc.ingest(forged)).toBe(false);
  });

  it('rejects stale and future-dated reports', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t, 300_000, 10_000);
    const stale = heartbeat(1, { uptimeSec: 1 }, t - 400_000);
    const future = heartbeat(2, { uptimeSec: 1 }, t + 60_000);
    expect(svc.ingest(stale.hb)).toBe(false);
    expect(svc.ingest(future.hb)).toBe(false);
  });

  it('keeps only the newest report per node and re-gossips only newer ones', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    const older = heartbeat(1, { uptimeSec: 100 }, t - 1_000);
    const newer = heartbeat(1, { uptimeSec: 200 }, t);
    expect(svc.ingest(newer.hb)).toBe(true);
    expect(svc.ingest(older.hb)).toBe(false); // not newer → not stored, not re-gossiped
    expect(svc.live()[0]?.uptimeSec).toBe(200);
    expect(svc.size).toBe(1);
  });

  it('prunes contributors not heard from within the window', () => {
    let t = 1_000_000;
    const svc = new ContributionService(() => t, 300_000);
    svc.ingest(heartbeat(1, { uptimeSec: 10 }, t).hb);
    t += 400_000; // advance past the window
    svc.prune();
    expect(svc.size).toBe(0);
  });
});

describe('ContributionService — scoring & distribution', () => {
  it('scores uptime, hosting and relay by their weights', () => {
    const report: ContributionReport = {
      nodeKey: 'x'.repeat(40),
      uptimeSec: 7_200, // 2h → 2 * uptime(1)
      agentsHosted: 3, // 3 * host(2) = 6
      txServed: 4, // 4 * relay(1) = 4
      ts: 0,
    };
    expect(ContributionService.score(report, WEIGHTS)).toBe(12);
  });

  it('splits the pool proportionally to score', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    svc.ingest(heartbeat(1, { uptimeSec: 3_600 }, t).hb); // score 1
    svc.ingest(heartbeat(2, { uptimeSec: 10_800 }, t).hb); // score 3
    const shares = svc.distribute(1_000, WEIGHTS, 0);
    const total = shares.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(1_000); // whole pool distributed, no dust lost
    const byKey = Object.fromEntries(shares.map((s) => [s.nodeKey, s.amount]));
    const n1 = heartbeat(1, {}, t).nodeKey;
    const n2 = heartbeat(2, {}, t).nodeKey;
    expect(byKey[n2]).toBe(750); // 3/4 of the pool
    expect(byKey[n1]).toBe(250); // 1/4 of the pool
  });

  it('enforces the per-node cap so one node cannot drain the pool', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    // One whale (score 100) and one small node (score 1); cap at 20% of the pool.
    svc.ingest(heartbeat(1, { txServed: 100 }, t).hb);
    svc.ingest(heartbeat(2, { txServed: 1 }, t).hb);
    const shares = svc.distribute(1_000, WEIGHTS, 2_000); // cap = 200
    const whale = shares.find((s) => s.nodeKey === heartbeat(1, {}, t).nodeKey);
    expect(whale?.amount).toBeLessThanOrEqual(200); // capped, cannot take the lot
  });

  it('returns nothing when the pool is 0 or there are no live contributors', () => {
    const t = 1_000_000;
    const svc = new ContributionService(() => t);
    expect(svc.distribute(0, WEIGHTS, 0)).toEqual([]);
    expect(svc.distribute(1_000, WEIGHTS, 0)).toEqual([]); // nobody live
  });

  it('is deterministic: same reports → identical, stably-ordered shares', () => {
    const t = 1_000_000;
    const a = new ContributionService(() => t);
    const b = new ContributionService(() => t);
    for (const svc of [a, b]) {
      svc.ingest(heartbeat(3, { uptimeSec: 3_600 }, t).hb);
      svc.ingest(heartbeat(1, { uptimeSec: 7_200 }, t).hb);
      svc.ingest(heartbeat(2, { agentsHosted: 5 }, t).hb);
    }
    expect(a.distribute(9_999, WEIGHTS, 0)).toEqual(b.distribute(9_999, WEIGHTS, 0));
  });
});

describe('nodeRewardWalletId', () => {
  it('is a valid, deterministic, per-node Web3 ID', () => {
    const key = toB64u(generateKeypair(seed(1)).publicKey);
    const id = nodeRewardWalletId(key);
    expect(isValidWeb3Id(id)).toBe(true);
    expect(nodeRewardWalletId(key)).toBe(id); // deterministic
    const other = nodeRewardWalletId(toB64u(generateKeypair(seed(2)).publicKey));
    expect(other).not.toBe(id); // distinct per node
  });
});
