import { sha256 } from '@noble/hashes/sha2.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { randomBytes } from '@noble/post-quantum/utils.js';
import { base58 } from '@scure/base';
import { fromB64u, toB64u, utf8ToBytes } from './encoding.js';

/**
 * The post-quantum signature scheme ACP uses everywhere identity or integrity matters.
 * ML-DSA-65 (FIPS 204, "Dilithium" family) targets a 192-bit security level and is the
 * balanced choice for a network of many small messages.
 */
export const SIGNATURE_ALG = 'ML-DSA-65' as const;

export interface Keypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** A keypair with its key material encoded as base64url strings for storage/transport. */
export interface EncodedKeypair {
  alg: typeof SIGNATURE_ALG;
  publicKey: string;
  secretKey: string;
}

/** Generate a fresh ML-DSA keypair. Pass a 32-byte `seed` for deterministic (test) keys. */
export function generateKeypair(seed?: Uint8Array): Keypair {
  return ml_dsa65.keygen(seed ?? randomBytes(32));
}

/** Sign a message with a secret key. Returns a raw ML-DSA signature. */
export function sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ml_dsa65.sign(message, secretKey);
}

/** Verify a signature against a message and public key. */
export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return ml_dsa65.verify(signature, message, publicKey);
  } catch {
    // Malformed inputs (wrong length, etc.) are treated as an invalid signature, not a crash.
    return false;
  }
}

/** Convenience: sign a UTF-8 string, returning a base64url signature. */
export function signString(secretKey: Uint8Array, message: string): string {
  return toB64u(sign(secretKey, utf8ToBytes(message)));
}

/** Convenience: verify a base64url signature over a UTF-8 string. */
export function verifyString(
  publicKey: Uint8Array,
  message: string,
  signatureB64u: string,
): boolean {
  return verify(publicKey, utf8ToBytes(message), fromB64u(signatureB64u));
}

/**
 * Derive a decentralized identifier from a public key: `did:acp:z<base58(sha256(pubkey))>`.
 * The `z` prefix follows the multibase base58btc convention. The DID is stable for the key
 * and reveals nothing about the secret.
 */
export function deriveDid(publicKey: Uint8Array): string {
  return `did:acp:z${base58.encode(sha256(publicKey))}`;
}

export function encodeKeypair(keys: Keypair): EncodedKeypair {
  return {
    alg: SIGNATURE_ALG,
    publicKey: toB64u(keys.publicKey),
    secretKey: toB64u(keys.secretKey),
  };
}

export function decodeKeypair(encoded: EncodedKeypair): Keypair {
  return {
    publicKey: fromB64u(encoded.publicKey),
    secretKey: fromB64u(encoded.secretKey),
  };
}
