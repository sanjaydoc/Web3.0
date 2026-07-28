import { buildTransfer, signTransaction, web3Id } from '@web3/core';
import type { Web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
import { Kernel } from '../src/kernel.js';

describe('POST /tx — trustless account-signed transfers (solo node)', () => {
  let kernel: Kernel;
  const alice = generateKeypair(new Uint8Array(32).fill(11));
  const bob = generateKeypair(new Uint8Array(32).fill(22));
  const ALICE = web3Id('alice');
  const BOB = web3Id('bob');
  let grant: number;

  const post = async (url: string, body: unknown) => {
    const res = await kernel.http.inject({ method: 'POST', url, payload: body as object });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  };
  const get = async (url: string) => {
    const res = await kernel.http.inject({ method: 'GET', url });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  };

  async function signTransferFromChainNonce(
    keys: Keypair,
    from: Web3Id,
    to: Web3Id,
    amount: number,
  ) {
    const { json } = await get(`/tx/nonce/${from}`);
    const nonce = json.nonce as number;
    return signTransaction(keys, buildTransfer({ from, to, amount, nonce }));
  }

  beforeAll(async () => {
    // Solo node, consensus OFF — acceptTx seals immediately (this node is the sole writer).
    kernel = new Kernel({ port: 0, host: '127.0.0.1' });
    await kernel.init();
    grant = kernel.config.faucetGrant;
    // Sign up both accounts WITH their on-chain signing keys.
    await post('/accounts/signup', {
      local: 'alice',
      role: 'operator',
      pubkey: toB64u(alice.publicKey),
    });
    await post('/accounts/signup', {
      local: 'bob',
      role: 'operator',
      pubkey: toB64u(bob.publicKey),
    });
  });

  afterAll(async () => {
    await kernel.close();
  });

  it('binds account keys on-chain and reports the starting nonce', async () => {
    const n = await get(`/tx/nonce/${ALICE}`);
    expect(n.json).toMatchObject({ account: ALICE, nonce: 0, bound: true });
    expect(kernel.networkAccounts.pubkeyOf(ALICE)).toBe(toB64u(alice.publicKey));
  });

  it('accepts and seals an owner-signed transfer', async () => {
    const tx = await signTransferFromChainNonce(alice, ALICE, BOB, 250);
    const res = await post('/tx', tx);
    expect(res.status).toBe(202);
    expect(res.json).toMatchObject({ ok: true });
    // Solo node sealed it synchronously.
    expect(kernel.ledger.balanceOf(ALICE)).toBe(grant - 250);
    expect(kernel.ledger.balanceOf(BOB)).toBe(grant + 250);
    // Nonce advanced on-chain.
    expect((await get(`/tx/nonce/${ALICE}`)).json.nonce).toBe(1);
  });

  it('rejects a replay of the sealed tx (422)', async () => {
    // Re-sign nonce 0 (already consumed) and resubmit.
    const replay = signTransaction(
      alice,
      buildTransfer({ from: ALICE, to: BOB, amount: 250, nonce: 0 }),
    );
    const res = await post('/tx', replay);
    expect(res.status).toBe(422);
    expect(res.json.ok).toBe(false);
  });

  it("rejects Mallory forging a transfer from Alice's account (422)", async () => {
    const mallory = generateKeypair(new Uint8Array(32).fill(33));
    const forged = signTransaction(
      mallory,
      buildTransfer({ from: ALICE, to: BOB, amount: 100, nonce: 1 }),
    );
    const res = await post('/tx', forged);
    expect(res.status).toBe(422);
    expect(String(res.json.error)).toMatch(/does not match/);
  });

  it('rejects a malformed body (400)', async () => {
    expect((await post('/tx', { not: 'a tx' })).status).toBe(400);
  });

  it('rejects an overspend (422)', async () => {
    const tx = await signTransferFromChainNonce(alice, ALICE, BOB, 10_000_000);
    const res = await post('/tx', tx);
    expect(res.status).toBe(422);
    expect(String(res.json.error)).toMatch(/insufficient/);
  });
});
