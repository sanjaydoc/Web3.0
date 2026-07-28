import { hashTx, verifyTransaction, web3Id } from '@web3/core';
import type { SignedTx } from '@web3/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Import the ACTUAL browser-side signing code the dashboard ships, to prove cross-impl interop:
// a tx signed in the browser must verify byte-for-byte in the node's core + mempool.
import { generateAccountKey, signTransfer } from '../../../apps/dashboard/src/txsign.js';

process.env.WEB3_LOG_LEVEL = 'silent';
import { Kernel } from '../src/kernel.js';

describe('browser ↔ node transaction interop', () => {
  const ALICE = web3Id('alice');
  const BOB = web3Id('bob');
  const key = generateAccountKey(); // browser keygen

  it('a browser-signed tx verifies in @web3/core and hashes identically', () => {
    const tx = signTransfer(key, { from: ALICE, to: BOB, amount: 250, nonce: 0 });
    // The node's canonical verifier accepts the browser signature → canonicalisation matches.
    expect(verifyTransaction(tx as unknown as SignedTx).ok).toBe(true);
    // The browser hash equals the core hash for the same body → SHA-256 canonicalisation matches.
    const body = {
      op: 'transfer' as const,
      from: tx.from as typeof ALICE,
      to: tx.to as typeof BOB,
      amount: tx.amount,
      currency: tx.currency as 'aETH',
      nonce: tx.nonce,
      ts: tx.ts,
      ...(tx.memo !== undefined ? { memo: tx.memo } : {}),
    };
    expect(hashTx(body)).toBe(tx.hash);
  });

  describe('end-to-end through a real node', () => {
    let kernel: Kernel;
    const bob = generateAccountKey();
    let grant: number;
    const post = async (url: string, b: unknown) => {
      const res = await kernel.http.inject({ method: 'POST', url, payload: b as object });
      return { status: res.statusCode, json: res.json() as Record<string, unknown> };
    };

    beforeAll(async () => {
      kernel = new Kernel({ port: 0, host: '127.0.0.1' });
      await kernel.init();
      grant = kernel.config.faucetGrant;
      await post('/accounts/signup', { local: 'alice', role: 'operator', pubkey: key.publicKey });
      await post('/accounts/signup', { local: 'bob', role: 'operator', pubkey: bob.publicKey });
    });
    afterAll(async () => {
      await kernel.close();
    });

    it('seals a browser-signed transfer end-to-end', async () => {
      const nonce = kernel.consensus.nextNonce(ALICE);
      const tx = signTransfer(key, { from: ALICE, to: BOB, amount: 400, nonce, memo: 'gm' });
      const res = await post('/tx', tx);
      expect(res.status).toBe(202);
      expect(kernel.ledger.balanceOf(ALICE)).toBe(grant - 400);
      expect(kernel.ledger.balanceOf(BOB)).toBe(grant + 400);
    });
  });
});
