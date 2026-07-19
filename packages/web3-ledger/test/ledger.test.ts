import { web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { InsufficientFundsError, Ledger, verifySnapshot } from '../src/index.js';

const alice = web3Id('alice');
const bob = web3Id('bob');

function newLedger(): Ledger {
  const keys = generateKeypair();
  let t = 0;
  // Deterministic, monotonic timestamps for reproducible hashes in tests.
  return new Ledger(keys, toB64u(keys.publicKey), () =>
    new Date(1_700_000_000_000 + t++).toISOString(),
  );
}

describe('Ledger', () => {
  let ledger: Ledger;
  beforeEach(() => {
    ledger = newLedger();
  });

  it('registers accounts with opening balances', () => {
    ledger.register(alice, 'did:web3:za', 1000);
    ledger.register(bob, 'did:web3:zb', 500);
    expect(ledger.balanceOf(alice)).toBe(1000);
    expect(ledger.balanceOf(bob)).toBe(500);
    expect(ledger.size).toBe(2);
  });

  it('transfers funds between wallets', () => {
    ledger.register(alice, 'did:web3:za', 1000);
    ledger.register(bob, 'did:web3:zb', 0);
    ledger.transfer(alice, bob, 250, { memo: 'task:summarise', taskId: 't1' });
    expect(ledger.balanceOf(alice)).toBe(750);
    expect(ledger.balanceOf(bob)).toBe(250);
  });

  it('refuses to overdraw a wallet', () => {
    ledger.register(alice, 'did:web3:za', 100);
    ledger.register(bob, 'did:web3:zb', 0);
    expect(() => ledger.transfer(alice, bob, 101)).toThrow(InsufficientFundsError);
    expect(ledger.balanceOf(alice)).toBe(100);
    expect(ledger.balanceOf(bob)).toBe(0);
  });

  it('mints faucet credits', () => {
    ledger.register(alice, 'did:web3:za', 0);
    ledger.mint(alice, 5000);
    expect(ledger.balanceOf(alice)).toBe(5000);
  });

  it('records message provenance without content', () => {
    ledger.register(alice, 'did:web3:za', 0);
    const entry = ledger.recordMessage({
      messageId: 'm1',
      from: alice,
      to: bob,
      bodyType: 'task.submit',
      contentHash: 'deadbeef',
    });
    expect(entry.type).toBe('message');
  });

  it('verifies an intact chain', () => {
    ledger.register(alice, 'did:web3:za', 1000);
    ledger.register(bob, 'did:web3:zb', 0);
    ledger.transfer(alice, bob, 100);
    const report = ledger.verifyChain();
    expect(report.ok).toBe(true);
    expect(report.brokenAt).toBe(-1);
    expect(report.entries).toBe(3);
  });

  it('detects a tampered entry in an exported snapshot (the integrity guarantee)', () => {
    ledger.register(alice, 'did:web3:za', 1000);
    ledger.register(bob, 'did:web3:zb', 0);
    ledger.transfer(alice, bob, 100);

    const snapshot = ledger.toJSON();
    expect(verifySnapshot(snapshot).ok).toBe(true);

    // Forge the payment: change 100 → 100000 in the persisted entry.
    (snapshot.entries[2] as { data: { amount: number } }).data.amount = 100_000;

    const report = verifySnapshot(snapshot);
    expect(report.ok).toBe(false);
    expect(report.brokenAt).toBe(2);
    expect(report.reason).toMatch(/tampered|hash/);
  });

  it('persists payments without optional fields as absent, not null (MongoDB round-trip)', () => {
    ledger.register(alice, 'did:web3:za', 1000);
    ledger.register(bob, 'did:web3:zb', 0);
    // A payment with NO memo/taskId — the case that broke hydrate() after a MongoDB restart,
    // because the driver stored the `undefined` fields as `null` and the reloaded entry no longer
    // hashed to its stored hash.
    ledger.transfer(alice, bob, 100);

    const payment = ledger.all()[2] as unknown as { data: Record<string, unknown> };
    // Unset optionals must be absent keys, so no store can materialise them as `null`.
    expect('memo' in payment.data).toBe(false);
    expect('taskId' in payment.data).toBe(false);

    // No entry may hold an `undefined` value anywhere — that's what diverges hashed vs stored form.
    const hasUndefined = (v: unknown): boolean =>
      Array.isArray(v)
        ? v.some(hasUndefined)
        : v && typeof v === 'object'
          ? Object.values(v).some((x) => x === undefined || hasUndefined(x))
          : false;
    expect(ledger.all().some((e) => hasUndefined(e))).toBe(false);

    // Simulate the exact persistence path: serialise and reload the whole snapshot. It must verify.
    const reloaded = JSON.parse(JSON.stringify(ledger.toJSON()));
    expect(verifySnapshot(reloaded).ok).toBe(true);
    expect(verifySnapshot(reloaded).entries).toBe(3);
  });

  it('links every entry to its predecessor', () => {
    ledger.register(alice, 'did:web3:za', 0);
    ledger.mint(alice, 10);
    const [first, second] = ledger.all();
    expect(second!.prevHash).toBe(first!.hash);
  });
});
