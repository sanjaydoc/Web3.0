import { Kernel } from './kernel.js';
import { resolveNodeKeys } from './keys.js';

/**
 * Boot an ACP node with the default configuration. Configure via environment variables
 * (ACP_PORT, ACP_HOST, ACP_FAUCET, ACP_SPEND_CAP, ACP_MONGODB_URI, ACP_NODE_SEED, …) — see
 * src/config.ts and src/keys.ts.
 */
async function main(): Promise<void> {
  const kernel = new Kernel(
    {},
    resolveNodeKeys((msg) => console.warn(msg)),
  );
  await kernel.init();
  await kernel.listen();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      kernel.close().then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { Kernel } from './kernel.js';
