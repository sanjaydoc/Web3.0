import { hashJson } from '@acp/crypto';
import type { Amount, Currency, Web3Id } from '@acp/core';

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
}

/** Provenance for a routed message: only its hash is recorded, never its content. */
export interface MessageData {
  messageId: string;
  from: Web3Id;
  to: Web3Id;
  bodyType: string;
  contentHash: string;
}

export type EntryType = 'register' | 'payment' | 'message';

export interface EntryData {
  register: RegisterData;
  payment: PaymentData;
  message: MessageData;
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
  return hashJson({ seq: core.seq, ts: core.ts, prevHash: core.prevHash, type: core.type, data: core.data });
}
