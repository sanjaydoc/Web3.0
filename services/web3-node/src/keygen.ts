import { randomBytes, toB64u } from '@web3/crypto';

/**
 * Print a fresh node seed. Run with `pnpm --filter @web3/node keygen`, then set the printed value
 * as WEB3_NODE_SEED in your deployment environment so the node keeps a stable signing identity
 * (and its persisted ledger verifies) across restarts.
 */
console.log(`WEB3_NODE_SEED=${toB64u(randomBytes(32))}`);
