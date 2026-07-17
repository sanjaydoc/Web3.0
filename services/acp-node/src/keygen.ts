import { randomBytes, toB64u } from '@acp/crypto';

/**
 * Print a fresh node seed. Run with `pnpm --filter @acp/node keygen`, then set the printed value
 * as ACP_NODE_SEED in your deployment environment so the node keeps a stable signing identity
 * (and its persisted ledger verifies) across restarts.
 */
console.log(`ACP_NODE_SEED=${toB64u(randomBytes(32))}`);
