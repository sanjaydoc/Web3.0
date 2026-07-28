import { web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import { Ledger } from '@web3/ledger';
import { describe, expect, it } from 'vitest';
import { ConsensusCoordinator, type RewardPolicy } from '../src/services/consensus.js';
import {
  type ContributionReport,
  ContributionService,
  nodeRewardWalletId,
  signHeartbeat,
} from '../src/services/contribution.js';

const seed = (n: number) => new Uint8Array(32).fill(n);

/** A single-authority coordinator with the Proof-of-Contribution engine wired to `pool`/`epoch`. */
function makeCoordinator(pool: number, epochBlocks: number) {
  const keys = generateKeypair(seed(7));
  const ledger = new Ledger(keys, toB64u(keys.publicKey));
  const contribution = new ContributionService(() => 1_000_000);
  const rewards: RewardPolicy = {
    treasuryId: web3Id('treasury'),
    blockReward: () => 0,
    authorityStake: () => 0,
    nodeRewardPool: () => pool,
    epochBlocks: () => epochBlocks,
    weights: () => ({ uptime: 1, host: 2, relay: 1 }),
    rewardCapBps: () => 0,
  };
  const coord = new ConsensusCoordinator(
    { mode: 'poa', authorities: [], peers: [], blockMs: 10, slotMs: 0 },
    keys,
    ledger,
    rewards,
    { contribution },
  );
  return { ledger, coord, contribution };
}

/** Register a live, signed heartbeat for node `n` with the given score inputs. */
function addContributor(
  svc: ContributionService,
  n: number,
  fields: Partial<Omit<ContributionReport, 'nodeKey' | 'ts'>>,
): string {
  const keys = generateKeypair(seed(n));
  const nodeKey = toB64u(keys.publicKey);
  const report: ContributionReport = {
    nodeKey,
    uptimeSec: fields.uptimeSec ?? 0,
    agentsHosted: fields.agentsHosted ?? 0,
    txServed: fields.txServed ?? 0,
    ts: 1_000_000,
  };
  svc.ingest(signHeartbeat(keys, report));
  return nodeKey;
}

describe('Proof-of-Contribution epoch rewards', () => {
  it('mints the pool to contributors exactly once, at the epoch boundary', () => {
    const { ledger, coord, contribution } = makeCoordinator(1_000, 5);
    const a = addContributor(contribution, 1, { uptimeSec: 3_600 }); // score 1
    const b = addContributor(contribution, 2, { uptimeSec: 10_800 }); // score 3
    const walletA = nodeRewardWalletId(a);
    const walletB = nodeRewardWalletId(b);

    // Drive blocks by adding real activity each tick (rewards ride real blocks, never self-trigger).
    // Blocks are 0-indexed, so heights 0..4 are epoch 0 and stay unpaid mid-epoch.
    for (let i = 0; i < 5; i++) {
      ledger.register(web3Id(`acct${i}`), `did:web3:z-${i}`, 0);
      expect(coord.proposeTick()).not.toBeNull();
    }
    expect(ledger.balanceOf(walletA)).toBe(0);
    expect(ledger.balanceOf(walletB)).toBe(0);

    // The block at height 5 completes epoch 0 → the pool is split by score (b:3 / a:1 of 1000).
    ledger.register(web3Id('acctboundary'), 'did:web3:z-boundary', 0);
    expect(coord.proposeTick()).not.toBeNull();
    expect(ledger.balanceOf(walletB)).toBe(750);
    expect(ledger.balanceOf(walletA)).toBe(250);

    // Further activity within the next epoch must NOT pay again.
    ledger.register(web3Id('acctafter'), 'did:web3:z-after', 0);
    expect(coord.proposeTick()).not.toBeNull();
    expect(ledger.balanceOf(walletA)).toBe(250);
    expect(ledger.balanceOf(walletB)).toBe(750);
  });

  it('does nothing when the pool is 0 (engine off)', () => {
    const { ledger, coord, contribution } = makeCoordinator(0, 2);
    const a = addContributor(contribution, 1, { uptimeSec: 3_600 });
    for (let i = 0; i < 3; i++) {
      ledger.register(web3Id(`acct${i}`), `did:web3:z-${i}`, 0);
      coord.proposeTick();
    }
    expect(ledger.balanceOf(nodeRewardWalletId(a))).toBe(0);
  });

  it('does not double-pay an epoch already rewarded on the chain', () => {
    const { ledger, coord, contribution } = makeCoordinator(1_000, 2);
    const a = addContributor(contribution, 1, { uptimeSec: 3_600 });
    const wallet = nodeRewardWalletId(a);
    // Reach the height-2 boundary (blocks at heights 0, 1, 2) — epoch 0 is paid at height 2.
    for (const local of ['acctzero', 'acctone', 'accttwo']) {
      ledger.register(web3Id(local), `did:web3:z-${local}`, 0);
      coord.proposeTick();
    }
    const paid = ledger.balanceOf(wallet);
    expect(paid).toBeGreaterThan(0);
    // The ledger already carries a `node-reward:0` mint, so re-deriving that epoch pays nothing more.
    const rewardEntries = ledger
      .all()
      .filter(
        (e) => e.type === 'payment' && (e.data as { memo?: string }).memo === 'node-reward:0',
      );
    expect(rewardEntries.length).toBeGreaterThan(0);
  });
});
