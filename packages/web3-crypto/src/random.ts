import { randomBytes } from '@noble/post-quantum/utils.js';
import { bytesToHex } from './encoding.js';

export { randomBytes };

/** A random hex string of `bytes` length (default 16 bytes → 32 hex chars). */
export function randomHex(bytes = 16): string {
  return bytesToHex(randomBytes(bytes));
}

/** A short, URL-safe random identifier suitable for message/task IDs. */
export function randomId(prefix = ''): string {
  const id = randomHex(12);
  return prefix ? `${prefix}_${id}` : id;
}
