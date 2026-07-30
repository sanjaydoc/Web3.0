// Browser-side account signing — the client half of trustless writes.
//
// The dashboard is a self-contained app (it can't import the private @web3/* packages), so this
// mirrors @web3/core's transaction canonicalisation + @web3/crypto's ML-DSA signing EXACTLY, using
// the same public primitives (@noble/post-quantum ML-DSA-65, @noble/hashes SHA-256, @scure/base
// base64url). A tx signed here verifies byte-for-byte in the node's mempool. Keep this in lockstep
// with packages/web3-core/src/transaction.ts.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { randomBytes } from '@noble/post-quantum/utils.js';
import { base64urlnopad } from '@scure/base';

const toB64u = (b: Uint8Array): string => base64urlnopad.encode(b);
const fromB64u = (s: string): Uint8Array => base64urlnopad.decode(s);

export interface AccountKey {
  /** base64url ML-DSA public key — bound on-chain, safe to share. */
  publicKey: string;
  /** base64url ML-DSA secret key — never leaves this device. */
  secretKey: string;
}

export interface SignedTx {
  op: 'transfer';
  from: string;
  to: string;
  amount: number;
  currency: string;
  memo?: string;
  nonce: number;
  ts: string;
  pubkey: string;
  sig: string;
  hash: string;
}

/** Deterministic JSON with deep-sorted keys — identical to @web3/crypto's canonicalize(). */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
const canonicalize = (value: unknown): string => JSON.stringify(sortDeep(value));

/** The exact object hashed + signed — undefined memo dropped, matching the core. */
function orderBody(b: {
  from: string;
  to: string;
  amount: number;
  currency: string;
  nonce: number;
  ts: string;
  memo?: string;
}): Record<string, unknown> {
  const core: Record<string, unknown> = {
    op: 'transfer',
    from: b.from,
    to: b.to,
    amount: b.amount,
    currency: b.currency,
    nonce: b.nonce,
    ts: b.ts,
  };
  if (b.memo !== undefined && b.memo !== '') core.memo = b.memo;
  return core;
}

/** Generate a fresh ML-DSA account keypair (encoded for storage/transport). */
export function generateAccountKey(): AccountKey {
  const kp = ml_dsa65.keygen(randomBytes(32));
  return { publicKey: toB64u(kp.publicKey), secretKey: toB64u(kp.secretKey) };
}

/** Sign a transfer with an account's secret key, producing a node-submittable SignedTx. */
export function signTransfer(
  key: AccountKey,
  input: {
    from: string;
    to: string;
    amount: number;
    nonce: number;
    currency?: string;
    memo?: string;
  },
): SignedTx {
  const body = {
    from: input.from,
    to: input.to,
    amount: input.amount,
    currency: input.currency ?? 'USDC',
    nonce: input.nonce,
    ts: new Date().toISOString(),
    memo: input.memo,
  };
  const message = utf8ToBytes(canonicalize(orderBody(body)));
  const hash = bytesToHex(sha256(message));
  const sig = toB64u(ml_dsa65.sign(message, fromB64u(key.secretKey)));
  const signed: SignedTx = {
    op: 'transfer',
    from: body.from,
    to: body.to,
    amount: body.amount,
    currency: body.currency,
    nonce: body.nonce,
    ts: body.ts,
    pubkey: key.publicKey,
    sig,
    hash,
  };
  if (body.memo !== undefined && body.memo !== '') signed.memo = body.memo;
  return signed;
}

/** The authorization fields an owner signs to allow recurring hosting debits (see HostingService). */
export interface LeaseMandateBody {
  owner: string;
  host: string;
  agentId: string;
  maxPerEpoch: number;
  maxEpochs: number;
  expiry: string;
  nonce: string;
}
export interface SignedLeaseMandate extends LeaseMandateBody {
  pubkey: string;
  signature: string;
}

/**
 * Sign a lease mandate with the owner's ML-DSA key — the client half of owner-authorized recurring
 * billing. Canonicalizes the SAME 7 fields the node verifies (`HostingService.verifyMandate`), so the
 * signature checks byte-for-byte against the owner's on-chain key.
 */
export function signLeaseMandate(key: AccountKey, body: LeaseMandateBody): SignedLeaseMandate {
  const ordered: LeaseMandateBody = {
    owner: body.owner,
    host: body.host,
    agentId: body.agentId,
    maxPerEpoch: body.maxPerEpoch,
    maxEpochs: body.maxEpochs,
    expiry: body.expiry,
    nonce: body.nonce,
  };
  const message = utf8ToBytes(canonicalize(ordered));
  const signature = toB64u(ml_dsa65.sign(message, fromB64u(key.secretKey)));
  return { ...ordered, pubkey: key.publicKey, signature };
}

/** A fresh mandate nonce (random, base64url). */
export function mandateNonce(): string {
  return toB64u(randomBytes(12));
}

// ── keystore: the account's secret key, kept in this browser keyed by address ──
const keyStoreId = (address: string): string => `web3.acctkey.${address}`;

export function loadAccountKey(address: string): AccountKey | null {
  const raw = localStorage.getItem(keyStoreId(address));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AccountKey;
    return parsed.publicKey && parsed.secretKey ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAccountKey(address: string, key: AccountKey): void {
  localStorage.setItem(keyStoreId(address), JSON.stringify(key));
}

export function hasAccountKey(address: string): boolean {
  return loadAccountKey(address) !== null;
}
