import { canonicalize, fromB64u, sha256Hex, toB64u, utf8ToBytes } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import { sign, verify } from '@web3/crypto';
import type { Web3Id } from './id.js';
import { DEFAULT_CURRENCY } from './wallet.js';
import type { Amount, Currency } from './wallet.js';

/**
 * A trustless, account-authorised transaction — the missing half of "one shared network".
 *
 * Ledger *entries* are signed by the NODE that seals them, which is why writes have always had to
 * go through an authority's authenticated HTTP API: nothing in an entry proves the value's *owner*
 * approved it. A `SignedTx` closes that gap. It is signed by the sending ACCOUNT's own ML-DSA key,
 * so any node — even an untrusted follower — can forward it, and the sealing authority can prove
 * the owner authorised the spend before it ever touches a balance. This is what lets a desktop
 * peer contribute writes to the chain without being able to forge someone else's payment.
 *
 * A tx only *authorises* a value movement; it becomes canonical when an authority validates it
 * (signature, balance, nonce) and seals a ledger entry from it. See the node's Mempool.
 */

/** The operations an account owner can authorise directly. `transfer` moves aETH between wallets. */
export type TxOp = 'transfer';

export const TX_OPS: readonly TxOp[] = ['transfer'];

/** The signed body — exactly the fields covered by the signature and the tx hash. */
export interface TxBody {
  op: TxOp;
  /** The sending account, e.g. `sanjay@web3.0`. Its bound key must match `pubkey`. */
  from: Web3Id;
  /** The receiving account. */
  to: Web3Id;
  /** Amount in minor units (100 minor = 1 aETH). */
  amount: Amount;
  currency: Currency;
  /** Optional human memo, recorded on the sealed entry. */
  memo?: string;
  /**
   * Per-sender replay guard: the sender's next expected nonce, starting at 0. An authority accepts
   * a tx only when its nonce equals the account's current nonce, then increments — so a captured tx
   * can never be replayed, and txs from one account apply in a defined order.
   */
  nonce: number;
  /** ISO timestamp the sender stamped (informational; ordering is by nonce, not time). */
  ts: string;
}

/** A transaction ready to broadcast: its body, the signer's public key, a signature, and an id. */
export interface SignedTx extends TxBody {
  /** base64url ML-DSA public key of the `from` account (bound on-chain at registration). */
  pubkey: string;
  /** base64url ML-DSA signature over the canonical body. */
  sig: string;
  /** SHA-256 (hex) of the canonical body — a stable id for dedupe/gossip. */
  hash: string;
}

/** Canonical hash of a tx body (sorted-key JSON → hex SHA-256). Excludes pubkey/sig/hash. */
export function hashTx(body: TxBody): string {
  return sha256Hex(utf8ToBytes(canonicalize(orderBody(body))));
}

/** The exact object shape that is hashed and signed — undefined memo dropped for stability. */
function orderBody(body: TxBody): Record<string, unknown> {
  const core: Record<string, unknown> = {
    op: body.op,
    from: body.from,
    to: body.to,
    amount: body.amount,
    currency: body.currency,
    nonce: body.nonce,
    ts: body.ts,
  };
  // Only include memo when set, so signing/verifying agree regardless of an absent field.
  if (body.memo !== undefined) core.memo = body.memo;
  return core;
}

export interface BuildTransferInput {
  from: Web3Id;
  to: Web3Id;
  amount: Amount;
  nonce: number;
  currency?: Currency;
  memo?: string;
  /** ISO timestamp; defaults to now. Injectable for deterministic tests. */
  ts?: string;
}

/** Build the unsigned body of a transfer transaction. */
export function buildTransfer(input: BuildTransferInput): TxBody {
  const body: TxBody = {
    op: 'transfer',
    from: input.from,
    to: input.to,
    amount: input.amount,
    currency: input.currency ?? DEFAULT_CURRENCY,
    nonce: input.nonce,
    ts: input.ts ?? new Date().toISOString(),
  };
  if (input.memo !== undefined && input.memo !== '') body.memo = input.memo;
  return body;
}

/** Sign a tx body with the sending account's keypair, producing a broadcastable `SignedTx`. */
export function signTransaction(keys: Keypair, body: TxBody): SignedTx {
  const hash = hashTx(body);
  const sig = toB64u(sign(keys.secretKey, utf8ToBytes(canonicalize(orderBody(body)))));
  return { ...body, pubkey: toB64u(keys.publicKey), sig, hash };
}

export interface TxVerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Cryptographically verify a tx in isolation: the hash matches the body, and the signature is a
 * valid ML-DSA signature by `pubkey` over that body. This proves *whoever holds the secret for
 * `pubkey`* authorised these exact fields — it does NOT prove `pubkey` is the right key for
 * `from`, nor that the balance/nonce are valid. Those are the mempool's job (it checks `pubkey`
 * against the account's on-chain binding and the live ledger state).
 */
export function verifyTransaction(tx: SignedTx): TxVerifyResult {
  if (!TX_OPS.includes(tx.op)) return { ok: false, reason: 'unknown op' };
  if (!Number.isInteger(tx.amount) || tx.amount <= 0) return { ok: false, reason: 'bad amount' };
  if (!Number.isInteger(tx.nonce) || tx.nonce < 0) return { ok: false, reason: 'bad nonce' };
  const body: TxBody = {
    op: tx.op,
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    currency: tx.currency,
    nonce: tx.nonce,
    ts: tx.ts,
  };
  if (tx.memo !== undefined) body.memo = tx.memo;
  if (hashTx(body) !== tx.hash) return { ok: false, reason: 'hash mismatch' };
  const message = utf8ToBytes(canonicalize(orderBody(body)));
  if (!verify(fromB64u(tx.pubkey), message, fromB64u(tx.sig))) {
    return { ok: false, reason: 'bad signature' };
  }
  return { ok: true };
}
