import { describe, expect, it } from 'vitest';
import {
  EarningsRegistry,
  IdentityRegistry,
  ReputationRegistry,
  combineReputation,
  economicScore,
} from '../src/index.js';

let t = 0;
const clock = () => `2026-07-30T00:00:${String(t++).padStart(2, '0')}.000Z`;

describe('economicScore', () => {
  it('is 0 with no payments and monotonic in count + payer diversity', () => {
    expect(economicScore(0, 0)).toBe(0);
    const one = economicScore(1, 1);
    expect(one).toBeGreaterThan(0);
    expect(economicScore(5, 1)).toBeGreaterThan(one); // more payments → higher
    expect(economicScore(5, 4)).toBeGreaterThanOrEqual(economicScore(5, 1)); // more payers → higher
    expect(economicScore(1000, 500)).toBeLessThanOrEqual(100); // bounded
  });
});

describe('EarningsRegistry', () => {
  it('aggregates earnings from x402-style settlements', () => {
    const id = new IdentityRegistry(clock);
    const earn = new EarningsRegistry(id);
    const a = id.newAgent({ agentDomain: 'srv@web3.0' });
    earn.record({
      agentId: a.agentId,
      amountAtomic: '50000',
      asset: 'USDC',
      payer: '0xP1',
      ts: clock(),
    });
    earn.record({
      agentId: a.agentId,
      amountAtomic: '50000',
      asset: 'USDC',
      payer: '0xP2',
      ts: clock(),
    });
    earn.record({
      agentId: a.agentId,
      amountAtomic: '100000',
      asset: 'USDC',
      payer: '0xP1',
      ts: clock(),
    });
    const s = earn.summary(a.agentId);
    expect(s.totalEarnedAtomic).toBe('200000');
    expect(s.paymentCount).toBe(3);
    expect(s.uniquePayers).toBe(2);
    expect(s.economicScore).toBeGreaterThan(0);
  });

  it('ignores payments to unknown agents', () => {
    const id = new IdentityRegistry(clock);
    const earn = new EarningsRegistry(id);
    expect(
      earn.record({ agentId: 999, amountAtomic: '1', asset: 'USDC', payer: '0xP', ts: clock() }),
    ).toBeUndefined();
  });
});

describe('combineReputation', () => {
  it('blends feedback (60%) and economic (40%) when both exist', () => {
    const id = new IdentityRegistry(clock);
    const rep = new ReputationRegistry(id, clock);
    const earn = new EarningsRegistry(id);
    const a = id.newAgent({ agentDomain: 'both@web3.0' });
    rep.giveFeedback({ agentId: a.agentId, client: '0xC', score: 100 });
    earn.record({
      agentId: a.agentId,
      amountAtomic: '50000',
      asset: 'USDC',
      payer: '0xP',
      ts: clock(),
    });
    const combined = combineReputation(rep.summary(a.agentId), earn.summary(a.agentId));
    expect(combined.feedbackScore).toBe(100);
    expect(combined.economicScore).toBeGreaterThan(0);
    // 0.6*100 + 0.4*economic → between economic and 100
    expect(combined.score).toBeGreaterThan(combined.economicScore);
    expect(combined.score).toBeLessThanOrEqual(100);
  });

  it('falls back to the single available dimension', () => {
    const id = new IdentityRegistry(clock);
    const rep = new ReputationRegistry(id, clock);
    const earn = new EarningsRegistry(id);
    const a = id.newAgent({ agentDomain: 'earnonly@web3.0' });
    earn.record({
      agentId: a.agentId,
      amountAtomic: '50000',
      asset: 'USDC',
      payer: '0xP',
      ts: clock(),
    });
    const combined = combineReputation(rep.summary(a.agentId), earn.summary(a.agentId));
    expect(combined.feedbackCount).toBe(0);
    expect(combined.score).toBe(combined.economicScore); // economic-only
  });
});
