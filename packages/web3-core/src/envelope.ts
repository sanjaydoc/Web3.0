import {
  canonicalize,
  deriveDid,
  fromB64u,
  randomId,
  signString,
  verifyString,
} from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import type { Web3Id } from './id.js';

/** Metadata bound into every signed envelope and covered by the signature. */
export interface EnvelopeMeta {
  signer: Web3Id;
  did: string;
  ts: string;
  nonce: string;
}

/**
 * A payload wrapped with an ML-DSA signature. The signature covers a canonical hash of
 * `{ payload, meta }`, so any tampering with the content, sender, or timestamp is detectable.
 * The signer's public key travels with the envelope, so a verifier can check it without a
 * registry lookup — and cross-check that it derives the claimed DID.
 */
export interface SignedEnvelope<T = unknown> {
  payload: T;
  meta: EnvelopeMeta;
  alg: 'ML-DSA-65';
  publicKey: string;
  signature: string;
}

function signingInput(payload: unknown, meta: EnvelopeMeta): string {
  return canonicalize({ payload, meta });
}

/** Seal a payload into a signed envelope on behalf of `signer`. */
export function seal<T>(
  keys: Keypair,
  signer: Web3Id,
  payload: T,
  publicKeyB64u: string,
  now: string,
): SignedEnvelope<T> {
  const meta: EnvelopeMeta = {
    signer,
    did: deriveDid(keys.publicKey),
    ts: now,
    nonce: randomId(),
  };
  return {
    payload,
    meta,
    alg: 'ML-DSA-65',
    publicKey: publicKeyB64u,
    signature: signString(keys.secretKey, signingInput(payload, meta)),
  };
}

export interface VerifyResult<T> {
  ok: boolean;
  reason?: string;
  payload?: T;
  meta?: EnvelopeMeta;
}

/**
 * Verify an envelope's signature and that the embedded public key derives the claimed DID.
 * Optionally pin an `expectedSigner` Web3.0 ID.
 */
export function open<T>(env: SignedEnvelope<T>, expectedSigner?: Web3Id): VerifyResult<T> {
  const publicKey = fromB64u(env.publicKey);
  if (deriveDid(publicKey) !== env.meta.did) {
    return { ok: false, reason: 'public key does not match DID' };
  }
  if (expectedSigner && env.meta.signer !== expectedSigner) {
    return { ok: false, reason: `signer mismatch: expected ${expectedSigner}` };
  }
  if (!verifyString(publicKey, signingInput(env.payload, env.meta), env.signature)) {
    return { ok: false, reason: 'invalid signature' };
  }
  return { ok: true, payload: env.payload, meta: env.meta };
}
