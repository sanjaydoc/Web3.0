import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Web3Config } from '../config.js';
import { MemoryStore } from './memory.js';
import { MongoStore } from './mongo.js';
import { PostgresStore } from './postgres.js';
import type { Store } from './store.js';

export type { Store } from './store.js';
export { MemoryStore } from './memory.js';
export { MongoStore } from './mongo.js';
export { PostgresStore } from './postgres.js';

/**
 * Path of a tiny on-disk marker recording the store backend this node last ran on. Anchored to the
 * home directory (stable across cwd changes, env drops, and pm2 restarts — the exact things that let
 * a missing WEB3_POSTGRES_URL slip through) so the downgrade guard below has a reliable memory.
 * Read at call time so WEB3_STORE_MODE_FILE (tests point it at a temp path) is always honored.
 */
function storeModeFile(): string {
  return process.env.WEB3_STORE_MODE_FILE || join(homedir(), '.web3', 'store-mode');
}

function readStoreMode(): string | null {
  const file = storeModeFile();
  try {
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
  } catch {
    return null;
  }
}

/**
 * Record the store backend a successful boot used. Called after the store connects, so the marker
 * only ever reflects a backend that actually worked. Best-effort: a write failure must never take
 * the node down.
 */
export function recordStoreMode(kind: Store['kind']): void {
  const file = storeModeFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, kind);
  } catch {
    /* best-effort marker — non-fatal */
  }
}

/**
 * Choose the store from config. Precedence: PostgreSQL (`WEB3_POSTGRES_URL`) → MongoDB
 * (`WEB3_MONGODB_URI`) → in-memory. This is the one place persistence is wired, so swapping backends
 * is a one-liner.
 *
 * Downgrade guard: if this node previously ran on a real database but no database is configured now,
 * REFUSE to boot on the in-memory store. Silently falling back to memory is what caused a live
 * incident — every account disappeared and auth fell open (`openMode`) because a `pm2 restart
 * --update-env` had dropped WEB3_POSTGRES_URL. Failing loud makes the process crash-loop with a
 * clear message so the operator restores the URL, instead of shipping an empty, wide-open node.
 */
export function createStore(config: Web3Config): Store {
  const configuredKind: Store['kind'] = config.postgresUrl
    ? 'postgres'
    : config.mongodbUri
      ? 'mongodb'
      : 'memory';

  if (configuredKind === 'memory') {
    const prior = readStoreMode();
    if (prior && prior !== 'memory') {
      throw new Error(
        `refusing to boot on the in-memory store: this node last ran on '${prior}', but no database is configured now (WEB3_POSTGRES_URL / WEB3_MONGODB_URI is missing). Booting on memory would drop every account and open auth. Restore the database URL (e.g. in .env or the process env), or delete ${storeModeFile()} to intentionally reset this node to a fresh in-memory instance.`,
      );
    }
  }

  if (config.postgresUrl) {
    return new PostgresStore(config.postgresUrl);
  }
  if (config.mongodbUri) {
    return new MongoStore(config.mongodbUri, config.mongodbDb);
  }
  return new MemoryStore();
}
