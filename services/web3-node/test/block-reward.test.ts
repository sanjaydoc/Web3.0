import { web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import { Ledger } from '@web3/ledger';
import { describe, expect, it } from 'vitest';
import { ConsensusCoordinator } from '../src/services/consensus.js';

const seed = (n: number) => new Uint8Array(32).fill(n);

function makeCoordinator(blockReward: number) {
  const keys = generateKeypair(seed(7));
  const ledger = new Ledger(keys, toB64u(keys.publicKey));
  const treasuryId = web3Id('treasury');
  const coord = new ConsensusCoordinator(
    { mode: 'poa', authorities: [], peers: [], blockMs: 10, slotMs: 0 },
    keys,
    ledger,
    { treasuryId, blockReward: () => blockReward, authorityStake: () => 0 },
  );
  return { ledger, coord, treasuryId };
}

/**
 * Regression: a block reward must NOT feed itself. Before the fix, the reward was minted AFTER the
 * block as a new ledger entry, which counted as "pending activity" and triggered the next block —
 * an endless chain of empty, self-rewarding blocks (runaway inflation + 100% CPU). The reward now
 * rides INSIDE the block it pays for and is marked committed, so only genuine activity makes blocks.
 */
describe('block reward does not self-trigger blocks', () => {
  it('rewards exactly once per real activity, never on its own', () => {
    const { ledger, coord, treasuryId } = makeCoordinator(50);

    // Genuine activity → one block, one reward.
    ledger.register(web3Id('alice'), 'did:web3:z-alice', 0);
    expect(coord.proposeTick()).not.toBeNull();
    expect(ledger.balanceOf(treasuryId)).toBe(50);

    // No new activity → NO further blocks and NO further rewards (this is the bug being guarded).
    expect(coord.proposeTick()).toBeNull();
    expect(coord.proposeTick()).toBeNull();
    expect(coord.proposeTick()).toBeNull();
    expect(ledger.balanceOf(treasuryId)).toBe(50);

    // More activity → exactly one more block + reward.
    ledger.register(web3Id('bob'), 'did:web3:z-bob', 0);
    expect(coord.proposeTick()).not.toBeNull();
    expect(ledger.balanceOf(treasuryId)).toBe(100);
    expect(coord.proposeTick()).toBeNull();
    expect(ledger.balanceOf(treasuryId)).toBe(100);
  });

  it('with reward 0, activity still produces one block and no loop', () => {
    const { ledger, coord } = makeCoordinator(0);
    ledger.register(web3Id('alice'), 'did:web3:z-a', 0);
    expect(coord.proposeTick()).not.toBeNull();
    expect(coord.proposeTick()).toBeNull();
  });
});
