import { web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import type { LedgerEntry } from '../src/entry.js';
import { Ledger, verifySnapshot } from '../src/index.js';
import { describe, expect, it } from 'vitest';

const alice = web3Id('alice');
const bob = web3Id('bob');

/** A Ledger with a fast retry schedule so failure paths don't slow the suite. */
function newLedger(): Ledger {
  const keys = generateKeypair();
  let t = 0;
  return new Ledger(
    keys,
    toB64u(keys.publicKey),
    () => new Date(1_700_000_000_000 + t++).toISOString(),
    { persistRetryDelaysMs: [0, 0, 0] },
  );
}

describe('Ledger durable-write queue', () => {
  it('persists every appended entry, in seq order, exactly once', async () => {
    const ledger = newLedger();
    const persisted: LedgerEntry[] = [];
    ledger.onPersist = async (entry) => {
      persisted.push(entry);
    };

    ledger.register(alice, 'did:web3:za', 1000);
    ledger.register(bob, 'did:web3:zb', 0);
    ledger.transfer(alice, bob, 250);
    await ledger.flush();

    expect(persisted.map((e) => e.seq)).toEqual([0, 1, 2]);
    // What was persisted is exactly the in-memory chain — and that snapshot verifies (no gap,
    // no reorder, every node signature intact).
    expect(persisted).toEqual(ledger.all());
    expect(verifySnapshot({ publicKey: ledger.toJSON().publicKey, entries: persisted }).ok).toBe(
      true,
    );
  });

  it('serializes writes even when the store resolves out of order', async () => {
    const ledger = newLedger();
    const order: number[] = [];
    // Make earlier seqs resolve LATER than later ones would if run concurrently. The queue must
    // still record them in seq order, because it never starts write N+1 until N has resolved.
    ledger.onPersist = (entry) =>
      new Promise<void>((resolve) => {
        const delay = entry.seq === 0 ? 30 : 1;
        setTimeout(() => {
          order.push(entry.seq);
          resolve();
        }, delay);
      });

    ledger.register(alice, 'did:web3:za', 1);
    ledger.register(bob, 'did:web3:zb', 1);
    await ledger.flush();

    expect(order).toEqual([0, 1]);
  });

  it('retries a transient store failure instead of dropping the entry (no gap)', async () => {
    const ledger = newLedger();
    const persisted: number[] = [];
    let failuresLeft = 2;
    ledger.onPersist = async (entry) => {
      if (entry.seq === 1 && failuresLeft > 0) {
        failuresLeft--;
        throw new Error('transient DB blip');
      }
      persisted.push(entry.seq);
    };

    ledger.register(alice, 'did:web3:za', 1);
    ledger.register(bob, 'did:web3:zb', 1); // seq 1 fails twice, then succeeds on retry
    ledger.transfer(alice, bob, 1);
    await ledger.flush();

    expect(failuresLeft).toBe(0);
    expect(persisted).toEqual([0, 1, 2]); // seq 1 landed — the chain has no hole
  });

  it('surfaces a permanent persistence failure through flush()', async () => {
    const ledger = newLedger();
    const errors: number[] = [];
    ledger.onPersistError = (entry) => errors.push(entry.seq);
    ledger.onPersist = async () => {
      throw new Error('store is down');
    };

    ledger.register(alice, 'did:web3:za', 1);
    await expect(ledger.flush()).rejects.toThrow('store is down');
    expect(errors).toEqual([0]); // reported exactly once, for the entry that gave up
  });

  it('flush() is a no-op when no persistence hook is set', async () => {
    const ledger = newLedger();
    ledger.register(alice, 'did:web3:za', 1);
    await expect(ledger.flush()).resolves.toBeUndefined();
  });
});
