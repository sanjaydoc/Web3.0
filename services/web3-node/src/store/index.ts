import type { AcpConfig } from '../config.js';
import { MemoryStore } from './memory.js';
import { MongoStore } from './mongo.js';
import type { Store } from './store.js';

export type { Store } from './store.js';
export { MemoryStore } from './memory.js';
export { MongoStore } from './mongo.js';

/**
 * Choose the store from config: a MongoDB Atlas store when `WEB3_MONGODB_URI` is set, otherwise the
 * in-memory store. This is the one place persistence is wired, so swapping backends is a one-liner.
 */
export function createStore(config: AcpConfig): Store {
  if (config.mongodbUri) {
    return new MongoStore(config.mongodbUri, config.mongodbDb);
  }
  return new MemoryStore();
}
