import { type SignedTx, verifyTransaction } from '@web3/core';
import type { Ledger } from '@web3/ledger';
import type { NetworkAccounts } from './network-accounts.js';

export interface AcceptResult {
  ok: boolean;
  reason?: string;
  /** True when the tx was already pending — accepted idempotently, not re-queued. */
  duplicate?: boolean;
}

/**
 * The mempool — the security gate for trustless writes.
 *
 * A `SignedTx` can arrive from anywhere: this node's own dashboard, or an untrusted peer that
 * forwarded it over gossip. Before it is ever allowed to move value, `accept()` proves five things:
 *
 *   1. the signature is a valid ML-DSA signature over the exact tx body,
 *   2. the signing key is the one bound on-chain to the `from` account (not an impostor's),
 *   3. the recipient is a real network account (a typo can't send funds into the void),
 *   4. the nonce is exactly the sender's next expected value (no replay, no gaps),
 *   5. the sender can cover the amount (counting anything already queued).
 *
 * Only entries that pass all five ever enter the pending set. On its turn, an authority calls
 * `drainAndSeal()` to convert pending txs into node-signed ledger payments — in nonce order,
 * re-checked against live balances — which then ride into the next block. Followers never seal;
 * they hold + forward, and learn the outcome when the block replicates back.
 */
export class Mempool {
  /** hash → tx. A single flat set; per-sender ordering is derived on demand. */
  private readonly pending = new Map<string, SignedTx>();

  constructor(
    private readonly ledger: Ledger,
    private readonly accounts: NetworkAccounts,
    private readonly maxPending = 10_000,
  ) {}

  size(): number {
    return this.pending.size;
  }

  /** The next nonce a client should use for `from` (chain nonce + anything already queued here). */
  nextNonce(from: string): number {
    return this.expectedNonce(from);
  }

  /**
   * Drop pending txs that can never seal because the sender's on-chain nonce has moved past them —
   * e.g. an authority already sealed this tx (or an equivalent one) into a block we just replicated.
   * Keeps the mempool from re-forwarding dead txs after a block lands.
   */
  prune(): void {
    for (const [hash, tx] of this.pending) {
      if (tx.nonce < this.accounts.nonceOf(tx.from)) this.pending.delete(hash);
    }
  }

  /** Validate a tx and queue it if it passes. Idempotent for an already-pending hash. */
  accept(tx: SignedTx): AcceptResult {
    if (this.pending.has(tx.hash)) return { ok: true, duplicate: true };

    const crypto = verifyTransaction(tx);
    if (!crypto.ok) return { ok: false, reason: crypto.reason ?? 'invalid signature' };

    const sender = this.accounts.get(tx.from);
    if (!sender) return { ok: false, reason: 'unknown sender account' };
    if (sender.pubkey !== tx.pubkey) {
      return { ok: false, reason: 'signature key does not match the account on-chain' };
    }
    if (!this.accounts.has(tx.to)) return { ok: false, reason: 'unknown recipient account' };
    if (tx.from === tx.to) return { ok: false, reason: 'cannot send to self' };

    const expected = this.expectedNonce(tx.from);
    if (tx.nonce !== expected) return { ok: false, reason: `bad nonce (expected ${expected})` };

    if (this.spendable(tx.from) < tx.amount) return { ok: false, reason: 'insufficient funds' };

    if (this.pending.size >= this.maxPending) return { ok: false, reason: 'mempool full' };
    this.pending.set(tx.hash, tx);
    return { ok: true };
  }

  /** The sender's next nonce, accounting for txs already queued from them this round. */
  private expectedNonce(from: string): number {
    return this.accounts.nonceOf(from) + this.bySender(from).length;
  }

  /** Ledger balance minus everything this sender already has queued. */
  private spendable(from: string): number {
    const queued = this.bySender(from).reduce((sum, t) => sum + t.amount, 0);
    return this.ledger.balanceOf(from as Parameters<Ledger['balanceOf']>[0]) - queued;
  }

  /** Pending txs from one sender, in nonce order. */
  private bySender(from: string): SignedTx[] {
    return [...this.pending.values()]
      .filter((t) => t.from === from)
      .sort((a, b) => a.nonce - b.nonce);
  }

  /**
   * Seal every currently-sealable pending tx into the ledger, in per-sender nonce order, and return
   * what was sealed. Re-validates against LIVE state (nonce + balance) because it may have moved
   * since `accept()` — a tx that no longer fits is left pending for a later round. Each sealed tx
   * becomes a node-signed `payment` carrying its nonce, so the sender's expected nonce advances
   * on-chain. Call this only on an authority, at propose time.
   */
  drainAndSeal(): SignedTx[] {
    const sealed: SignedTx[] = [];
    // Loop until a full pass seals nothing, so a sender's 0,1,2… drain in one call.
    let progressed = true;
    while (progressed) {
      progressed = false;
      const senders = new Set([...this.pending.values()].map((t) => t.from));
      for (const from of senders) {
        const next = this.bySender(from)[0];
        if (!next) continue;
        if (next.nonce !== this.accounts.nonceOf(from)) continue; // wait for the in-order tx
        const bal = this.ledger.balanceOf(from as Parameters<Ledger['balanceOf']>[0]);
        if (bal < next.amount) continue; // can't cover it right now
        this.ledger.transfer(
          next.from as Parameters<Ledger['transfer']>[0],
          next.to as Parameters<Ledger['transfer']>[1],
          next.amount,
          { memo: next.memo, nonce: next.nonce },
        );
        this.pending.delete(next.hash);
        sealed.push(next);
        progressed = true;
      }
    }
    return sealed;
  }
}
