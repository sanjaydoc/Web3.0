import { buildTransfer, signTransaction, web3Id } from '@web3/core';
import type { Web3Id } from '@web3/core';
import { deriveDid, generateKeypair, toB64u } from '@web3/crypto';
import { Ledger } from '@web3/ledger';
import type { Keypair } from '@web3/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Mempool } from '../src/services/mempool.js';
import { NetworkAccounts } from '../src/services/network-accounts.js';

const seed = (n: number) => new Uint8Array(32).fill(n);
const node = generateKeypair(seed(9));
const aliceKeys = generateKeypair(seed(1));
const bobKeys = generateKeypair(seed(2));
const malloryKeys = generateKeypair(seed(3));

const ALICE = web3Id('alice');
const BOB = web3Id('bob');
const CAROL = web3Id('carol');

let ledger: Ledger;
let accounts: NetworkAccounts;
let mempool: Mempool;

/** Bind an account on-chain (key binding + faucet grant), exactly as signup will. */
function onboard(id: Web3Id, keys: Keypair, grant: number): void {
  ledger.bindAccount(id, 'operator', toB64u(keys.publicKey), deriveDid(keys.publicKey));
  if (grant > 0) ledger.mint(id, grant);
}

function signedTransfer(keys: Keypair, from: Web3Id, to: Web3Id, amount: number, nonce: number) {
  return signTransaction(keys, buildTransfer({ from, to, amount, nonce }));
}

beforeEach(() => {
  ledger = new Ledger(node, toB64u(node.publicKey));
  accounts = new NetworkAccounts();
  // Every appended entry updates the network index — mirrors kernel's onAppend wiring.
  ledger.onAppend = (e) => accounts.observe(e);
  mempool = new Mempool(ledger, accounts);
  onboard(ALICE, aliceKeys, 1000);
  onboard(BOB, bobKeys, 0);
});

describe('NetworkAccounts (on-chain key binding)', () => {
  it('learns each account key from the chain', () => {
    expect(accounts.pubkeyOf(ALICE)).toBe(toB64u(aliceKeys.publicKey));
    expect(accounts.roleOf(ALICE)).toBe('operator');
    expect(accounts.has(BOB)).toBe(true);
    expect(accounts.has(CAROL)).toBe(false);
    expect(accounts.nonceOf(ALICE)).toBe(0);
  });
});

describe('Mempool validation (the security gate)', () => {
  it('accepts a well-formed, owner-signed transfer', () => {
    const tx = signedTransfer(aliceKeys, ALICE, BOB, 250, 0);
    expect(mempool.accept(tx)).toMatchObject({ ok: true });
    expect(mempool.size()).toBe(1);
  });

  it('rejects a spend from an unknown sender', () => {
    const tx = signedTransfer(malloryKeys, CAROL, BOB, 10, 0);
    expect(mempool.accept(tx).ok).toBe(false);
  });

  it("rejects Mallory forging a spend from Alice's account", () => {
    // from: ALICE, but signed with Mallory's key → embedded pubkey is Mallory's, which is NOT
    // the key bound to alice on-chain. This is the core attack the mempool must stop.
    const tx = signTransaction(malloryKeys, buildTransfer({ from: ALICE, to: web3Id('mallory'), amount: 900, nonce: 0 }));
    const res = mempool.accept(tx);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/does not match/);
  });

  it('rejects a bad nonce', () => {
    expect(mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 10, 5)).ok).toBe(false);
  });

  it('rejects insufficient funds', () => {
    expect(mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 999_999, 0)).ok).toBe(false);
  });

  it('rejects a transfer to an unknown recipient', () => {
    expect(mempool.accept(signedTransfer(aliceKeys, ALICE, CAROL, 10, 0)).ok).toBe(false);
  });

  it('rejects sending to self', () => {
    expect(mempool.accept(signedTransfer(aliceKeys, ALICE, ALICE, 10, 0)).ok).toBe(false);
  });

  it('accepts an idempotent duplicate without re-queuing', () => {
    const tx = signedTransfer(aliceKeys, ALICE, BOB, 250, 0);
    expect(mempool.accept(tx).ok).toBe(true);
    const again = mempool.accept(tx);
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(mempool.size()).toBe(1);
  });
});

describe('authority seal + nonce advance', () => {
  it('seals a valid transfer and moves the balances', () => {
    mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 250, 0));
    const sealed = mempool.drainAndSeal();
    expect(sealed).toHaveLength(1);
    expect(ledger.balanceOf(ALICE)).toBe(750);
    expect(ledger.balanceOf(BOB)).toBe(250);
    expect(accounts.nonceOf(ALICE)).toBe(1); // nonce advanced on-chain
    expect(mempool.size()).toBe(0);
  });

  it('blocks replay of a sealed tx (nonce already consumed)', () => {
    const tx = signedTransfer(aliceKeys, ALICE, BOB, 250, 0);
    mempool.accept(tx);
    mempool.drainAndSeal();
    // Re-submitting the exact same tx now fails: its nonce (0) is behind the expected (1).
    const replay = mempool.accept(tx);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toMatch(/nonce/);
  });

  it('queues and seals several txs from one sender in nonce order', () => {
    mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 100, 0));
    mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 200, 1));
    mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 300, 2));
    const sealed = mempool.drainAndSeal();
    expect(sealed.map((t) => t.nonce)).toEqual([0, 1, 2]);
    expect(ledger.balanceOf(ALICE)).toBe(400);
    expect(ledger.balanceOf(BOB)).toBe(600);
    expect(accounts.nonceOf(ALICE)).toBe(3);
  });

  it("a follower's index, fed only the sealed entries, derives the same nonce", () => {
    mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 100, 0));
    mempool.accept(signedTransfer(aliceKeys, ALICE, BOB, 200, 1));
    mempool.drainAndSeal();
    // Replay every ledger entry into a fresh index, as a peer does from block gossip.
    const follower = new NetworkAccounts();
    for (const e of ledger.all()) follower.observe(e);
    expect(follower.nonceOf(ALICE)).toBe(2);
    expect(follower.pubkeyOf(ALICE)).toBe(toB64u(aliceKeys.publicKey));
  });
});
