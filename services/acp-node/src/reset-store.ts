import './env.js'; // load .env so ACP_MONGODB_URI / ACP_MONGODB_DB are available
import { MongoClient } from 'mongodb';

/**
 * Wipe the persisted ACP state (agent registry + ledger) from MongoDB so the node can boot fresh.
 *
 * Use this when the persisted ledger can't be verified on startup — e.g. it was written by an
 * older/buggy build, or by a different node identity (`ACP_NODE_SEED`). The ledger is intentionally
 * strict: it refuses to hydrate a chain whose hashes or signatures don't check out, rather than
 * silently trusting tampered data. Clearing the store is the correct reset for local dev.
 *
 *   pnpm --filter @acp/node reset-store
 */
async function main(): Promise<void> {
  const uri = process.env.ACP_MONGODB_URI;
  const dbName = process.env.ACP_MONGODB_DB ?? 'acp';
  if (!uri) {
    console.error(
      'ACP_MONGODB_URI is not set — nothing to reset (the in-memory store starts fresh already).',
    );
    process.exit(1);
  }

  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  try {
    const db = client.db(dbName);
    for (const name of ['ledger_entries', 'agents']) {
      const deleted = await db.collection(name).deleteMany({});
      console.log(`cleared ${deleted.deletedCount} document(s) from ${dbName}.${name}`);
    }
    console.log('done — start the node again and it will register a fresh, verifiable ledger.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
