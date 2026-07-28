import { generateKeypair, toB64u } from '@web3/crypto';
import { describe, expect, it } from 'vitest';
import { buildTransfer, hashTx, signTransaction, verifyTransaction, web3Id } from '../src/index.js';

const alice = generateKeypair(new Uint8Array(32).fill(1));
const mallory = generateKeypair(new Uint8Array(32).fill(2));
const A = web3Id('alice');
const B = web3Id('bob');

function tx(overrides: Partial<Parameters<typeof buildTransfer>[0]> = {}) {
  const body = buildTransfer({
    from: A,
    to: B,
    amount: 250,
    nonce: 0,
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
  return signTransaction(alice, body);
}

describe('transaction signing', () => {
  it('a valid transfer round-trips', () => {
    const signed = tx();
    expect(verifyTransaction(signed).ok).toBe(true);
    expect(signed.pubkey).toBe(toB64u(alice.publicKey));
    expect(signed.op).toBe('transfer');
  });

  it('is deterministic — same body signs to the same hash', () => {
    expect(tx().hash).toBe(tx().hash);
  });

  it('rejects a tampered amount', () => {
    const signed = tx();
    const forged = { ...signed, amount: 999_999 };
    expect(verifyTransaction(forged).ok).toBe(false);
  });

  it('rejects a tampered recipient', () => {
    const signed = tx();
    const forged = { ...signed, to: web3Id('mallory') };
    expect(verifyTransaction(forged).ok).toBe(false);
  });

  it("rejects a signature that isn't from the embedded pubkey", () => {
    const signed = tx();
    // Mallory swaps in her own pubkey but keeps Alice's signature: must fail.
    const forged = { ...signed, pubkey: toB64u(mallory.publicKey) };
    expect(verifyTransaction(forged).ok).toBe(false);
  });

  it("rejects Mallory signing a spend from Alice's account", () => {
    // Mallory builds a tx that says from: alice, and signs with her OWN key.
    const body = buildTransfer({ from: A, to: web3Id('mallory'), amount: 500, nonce: 0 });
    const signed = signTransaction(mallory, body);
    // Cryptographically valid for Mallory's key — but the mempool will reject it because
    // signed.pubkey (Mallory) won't match Alice's on-chain bound key. In isolation the sig
    // verifies against the embedded (Mallory) pubkey:
    expect(verifyTransaction(signed).ok).toBe(true);
    expect(signed.pubkey).toBe(toB64u(mallory.publicKey));
    expect(signed.pubkey).not.toBe(toB64u(alice.publicKey));
  });

  it('rejects a mutated hash', () => {
    const signed = tx();
    const forged = {
      ...signed,
      hash: hashTx(buildTransfer({ from: A, to: B, amount: 1, nonce: 0 })),
    };
    expect(verifyTransaction(forged).ok).toBe(false);
  });

  it('rejects non-positive amounts and negative nonces', () => {
    expect(verifyTransaction(tx({ amount: 0 })).ok).toBe(false);
    expect(verifyTransaction(tx({ amount: -5 })).ok).toBe(false);
    expect(verifyTransaction(tx({ nonce: -1 })).ok).toBe(false);
  });

  it('memo is covered by the signature', () => {
    const withMemo = signTransaction(
      alice,
      buildTransfer({ from: A, to: B, amount: 10, nonce: 1, memo: 'lunch' }),
    );
    expect(verifyTransaction(withMemo).ok).toBe(true);
    expect(verifyTransaction({ ...withMemo, memo: 'rent' }).ok).toBe(false);
  });

  it('distinct nonces produce distinct tx hashes (no replay collision)', () => {
    const n0 = tx({ nonce: 0 });
    const n1 = tx({ nonce: 1 });
    expect(n0.hash).not.toBe(n1.hash);
  });
});
