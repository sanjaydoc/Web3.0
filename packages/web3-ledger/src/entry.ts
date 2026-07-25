import type { Amount, Currency, Web3Id } from '@web3/core';
import { hashJson } from '@web3/crypto';

/** The hash a genesis entry links back to. */
export const GENESIS_HASH = '0'.repeat(64);

/** An account joined the network (optionally with an opening balance / faucet grant). */
export interface RegisterData {
  web3Id: Web3Id;
  did: string;
  openingBalance: Amount;
  currency: Currency;
}

/**
 * A value transfer. `from: null` mints new credits (faucet / opening balance); otherwise it
 * moves `amount` from one wallet to another. This is where "effortless agentic payments" settle.
 */
export interface PaymentData {
  from: Web3Id | null;
  to: Web3Id;
  amount: Amount;
  currency: Currency;
  memo?: string;
  taskId?: string;
  /**
   * When this payment was sealed from an account-signed transaction, the sender's tx nonce. It
   * makes the sender's next expected nonce derivable from the chain (replay protection survives a
   * restart) and marks the entry as owner-authorised rather than node-originated. Absent on
   * node-originated payments (faucet mints, fees, block rewards, staking moves).
   */
  nonce?: number;
}

/**
 * An account's on-chain identity: binds a human/agent address to the ML-DSA public key that
 * authorises its transactions. Carried in a replicated block entry so EVERY node — including
 * untrusted peers — learns each account's key by replaying the chain, and can therefore verify
 * account-signed transactions without trusting whoever forwarded them. No balance effect.
 */
export interface AccountData {
  web3Id: Web3Id;
  role: string;
  /** base64url ML-DSA public key that signs this account's transactions. */
  pubkey: string;
  did: string;
}

/** Provenance for a routed message: only its hash is recorded, never its content. */
export interface MessageData {
  messageId: string;
  from: Web3Id;
  to: Web3Id;
  bodyType: string;
  contentHash: string;
}

export type EntryType = 'register' | 'payment' | 'message' | 'account';

export interface EntryData {
  register: RegisterData;
  payment: PaymentData;
  message: MessageData;
  account: AccountData;
}

/** The signed, hash-linked body of the fields covered by the entry hash. */
export interface EntryCore<T extends EntryType = EntryType> {
  seq: number;
  ts: string;
  prevHash: string;
  type: T;
  data: EntryData[T];
}

/** A committed ledger entry: its core, a content hash, and the node's post-quantum signature. */
export interface LedgerEntry<T extends EntryType = EntryType> extends EntryCore<T> {
  /** SHA-256 over the canonical core. */
  hash: string;
  /** The node authority's ML-DSA signature over `hash` (base64url). */
  signature: string;
}

/** Compute the canonical hash of an entry's core fields. */
export function hashEntry(core: EntryCore): string {
  return hashJson({
    seq: core.seq,
    ts: core.ts,
    prevHash: core.prevHash,
    type: core.type,
    data: core.data,
  });
}
