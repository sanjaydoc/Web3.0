import type { AgentCard } from '@web3/core';
import type { LedgerEntry } from '@web3/ledger';
import { MongoClient } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Store } from './store.js';

/**
 * MongoDB (Atlas) store. Point the node at a cluster with `WEB3_MONGODB_URI` and state persists
 * across restarts. Agent cards live in `agents` (unique on `web3Id`); ledger entries live in
 * `ledger_entries` (unique on `seq`, which also rejects accidental double-appends).
 *
 * The connection string carries credentials, so it only ever comes from the environment — never
 * the repo.
 */
export class MongoStore implements Store {
  readonly kind = 'mongodb' as const;
  private readonly client: MongoClient;
  private agents!: Collection<AgentCard>;
  private entries!: Collection<LedgerEntry>;
  private settings!: Collection<{ key: string; value: unknown }>;

  constructor(
    uri: string,
    private readonly dbName = 'acp',
  ) {
    // `ignoreUndefined` keeps the driver from persisting `undefined` fields as `null`, which would
    // otherwise alter a ledger entry's canonical hash on reload (see Ledger.append's pruneUndefined).
    this.client = new MongoClient(uri, { ignoreUndefined: true });
  }

  async init(): Promise<void> {
    await this.client.connect();
    const db = this.client.db(this.dbName);
    this.agents = db.collection<AgentCard>('agents');
    this.entries = db.collection<LedgerEntry>('ledger_entries');
    this.settings = db.collection<{ key: string; value: unknown }>('settings');
    await this.agents.createIndex({ web3Id: 1 }, { unique: true });
    await this.entries.createIndex({ seq: 1 }, { unique: true });
    await this.settings.createIndex({ key: 1 }, { unique: true });
  }

  async loadSetting<T = unknown>(key: string): Promise<T | null> {
    const doc = await this.settings.findOne({ key }, { projection: { _id: 0 } });
    return doc ? (doc.value as T) : null;
  }

  async saveSetting(key: string, value: unknown): Promise<void> {
    await this.settings.updateOne({ key }, { $set: { key, value } }, { upsert: true });
  }

  async loadAgents(): Promise<AgentCard[]> {
    const docs = await this.agents.find({}, { projection: { _id: 0 } }).toArray();
    return docs as unknown as AgentCard[];
  }

  async saveAgent(card: AgentCard): Promise<void> {
    await this.agents.updateOne({ web3Id: card.web3Id }, { $set: card }, { upsert: true });
  }

  async loadLedger(): Promise<LedgerEntry[]> {
    const docs = await this.entries
      .find({}, { projection: { _id: 0 } })
      .sort({ seq: 1 })
      .toArray();
    return docs as unknown as LedgerEntry[];
  }

  async appendEntry(entry: LedgerEntry): Promise<void> {
    await this.entries.insertOne({ ...entry } as LedgerEntry);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
