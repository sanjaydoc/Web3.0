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
 * Choose the store from config. Precedence: PostgreSQL (`WEB3_POSTGRES_URL`) → MongoDB
 * (`WEB3_MONGODB_URI`) → in-memory. This is the one place persistence is wired, so swapping backends
 * is a one-liner.
 */
export function createStore(config: Web3Config): Store {
  if (config.postgresUrl) {
    return new PostgresStore(config.postgresUrl);
  }
  if (config.mongodbUri) {
    return new MongoStore(config.mongodbUri, config.mongodbDb);
  }
  return new MemoryStore();
}
