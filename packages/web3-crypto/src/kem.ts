import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { randomBytes } from '@noble/post-quantum/utils.js';
import { fromB64u, toB64u } from './encoding.js';

/**
 * The post-quantum key-encapsulation mechanism Web3.0 uses to share data confidentially between
 * agents. ML-KEM-768 (FIPS 203, "Kyber" family) establishes a shared secret; we then encrypt
 * the payload with XChaCha20-Poly1305 — a hybrid PQC "sealed box".
 */
export const KEM_ALG = 'ML-KEM-768' as const;

export interface KemKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** A payload encrypted for a recipient's KEM public key. Safe to send over any channel. */
export interface SealedBox {
  alg: typeof KEM_ALG;
  /** The ML-KEM ciphertext carrying the encapsulated shared secret. */
  kem: string;
  /** XChaCha20-Poly1305 nonce. */
  nonce: string;
  /** The encrypted payload (base64url). */
  ct: string;
}

export function generateKemKeypair(seed?: Uint8Array): KemKeypair {
  return ml_kem768.keygen(seed ?? randomBytes(64));
}

/** Encrypt `plaintext` so that only the holder of the recipient's KEM secret key can read it. */
export function seal(recipientPublicKey: Uint8Array, plaintext: Uint8Array): SealedBox {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipientPublicKey);
  const key = sha256(sharedSecret);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return { alg: KEM_ALG, kem: toB64u(cipherText), nonce: toB64u(nonce), ct: toB64u(ct) };
}

/** Decrypt a sealed box using the recipient's KEM secret key. */
export function open(recipientSecretKey: Uint8Array, box: SealedBox): Uint8Array {
  const sharedSecret = ml_kem768.decapsulate(fromB64u(box.kem), recipientSecretKey);
  const key = sha256(sharedSecret);
  return xchacha20poly1305(key, fromB64u(box.nonce)).decrypt(fromB64u(box.ct));
}
