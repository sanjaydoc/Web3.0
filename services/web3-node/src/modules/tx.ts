import type { SignedTx } from '@web3/core';
import type { ModuleContext, Web3Module } from '../context.js';

/**
 * tx — the trustless write surface. `POST /tx` accepts an account-signed transaction from anyone
 * (the sender's own dashboard, or a peer forwarding it): no node login required, because the tx is
 * self-authorising — it carries the sender's ML-DSA signature. The mempool proves ownership, nonce,
 * and funds before it can move value; an authority then seals it into a block. `GET /tx/nonce/:acct`
 * tells a client which nonce to sign next.
 *
 * This is what lets a follower peer node contribute writes to the shared chain without being
 * trusted: it forwards the signed tx, and the sealing authority does the verifying.
 */
export function txModule(): Web3Module {
  return {
    name: 'tx',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, consensus, bus, networkAccounts } = ctx;

      http.post('/tx', async (request, reply) => {
        const tx = request.body as SignedTx | undefined;
        if (!tx || typeof tx !== 'object' || tx.op !== 'transfer') {
          return reply.code(400).send({ error: 'a signed transfer transaction is required' });
        }
        const result = consensus.submitTx(tx);
        if (!result.ok) {
          // 422: well-formed request, but the tx failed validation (bad sig / nonce / funds).
          return reply.code(422).send({ ok: false, error: result.reason });
        }
        if (!result.duplicate) {
          bus.emit({
            kind: 'tx.submitted',
            summary: `tx ${tx.hash.slice(0, 10)}… ${tx.from} → ${tx.to} (${tx.amount})`,
            data: { from: tx.from, to: tx.to, amount: tx.amount, nonce: tx.nonce },
          });
        }
        return reply
          .code(202)
          .send({ ok: true, hash: tx.hash, duplicate: result.duplicate ?? false });
      });

      // The next nonce this account must sign with (chain state + anything already queued locally).
      http.get<{ Params: { account: string } }>('/tx/nonce/:account', async (request) => {
        const account = request.params.account;
        return {
          account,
          nonce: consensus.nextNonce(account),
          bound: networkAccounts.has(account),
          // The account's on-chain signing key, so the client can tell whether THIS device's key
          // still matches (a different device / re-install has a different key → sends would be
          // rejected with "signature key does not match the account on-chain" until it re-binds).
          pubkey: networkAccounts.pubkeyOf(account) ?? null,
        };
      });

      // Lightweight status for the dashboard / debugging.
      http.get('/tx', async () => ({
        pending: ctx.mempool.size(),
        accounts: networkAccounts.size,
      }));
    },
  };
}
