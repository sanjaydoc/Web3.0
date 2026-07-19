import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';

export { bytesToHex, hexToBytes, utf8ToBytes };

/** Base64url (no padding) — the transport encoding for keys, signatures and ciphertext in JSON. */
export function toB64u(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

export function fromB64u(text: string): Uint8Array {
  return base64urlnopad.decode(text);
}

/** SHA-256 of raw bytes, hex-encoded. */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/**
 * Deterministic JSON serialisation with sorted keys. Two structurally-equal objects always
 * produce the same string, so their hashes and signatures match across languages and runs.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

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

/** Canonical-hash any JSON-serialisable value (sorted keys) to a hex SHA-256 digest. */
export function hashJson(value: unknown): string {
  return sha256Hex(utf8ToBytes(canonicalize(value)));
}
