import { fromB64u, generateKeypair } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';

/**
 * Resolve the node's signing identity. In production the node key MUST be stable across restarts,
 * or the persisted ledger (signed by the old key) won't verify on reboot. Set `WEB3_NODE_SEED` to a
 * 32-byte base64url seed — `generateKeypair(seed)` is deterministic, so the same seed always
 * reproduces the same keypair. Generate one with `pnpm --filter @web3/node keygen`.
 *
 * Without a seed the node uses an ephemeral key (fine for dev/tests, but state won't survive a
 * restart) and logs a warning.
 */
export function resolveNodeKeys(warn?: (message: string) => void): Keypair {
  const seedEnv = process.env.WEB3_NODE_SEED;
  if (seedEnv) {
    const seed = fromB64u(seedEnv);
    if (seed.length !== 32) {
      throw new Error(`WEB3_NODE_SEED must decode to 32 bytes (got ${seed.length})`);
    }
    return generateKeypair(seed);
  }
  warn?.(
    'WEB3_NODE_SEED is not set — using an ephemeral node key. Persisted ledger data will NOT verify ' +
      'after a restart. Run `pnpm --filter @web3/node keygen` and set WEB3_NODE_SEED for a durable identity.',
  );
  return generateKeypair();
}
