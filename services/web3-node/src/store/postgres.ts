import type { AgentCard } from '@web3/core';
import type { LedgerEntry } from '@web3/ledger';
import pg from 'pg';
import type { Store } from './store.js';

const { Pool } = pg;

/**
 * PostgreSQL store. Point the node at a database with `WEB3_POSTGRES_URL` and all state persists on
 * that server's own disk — no external service, no storage cap (ideal for a self-hosted node on a
 * box with real disk, e.g. an Oracle Always-Free VM's 100 GB).
 *
 * Three tables, mirroring the Mongo backend: `agents` (keyed on web3Id), `ledger_entries` (keyed on
 * seq, which also rejects accidental double-appends), and `settings` (keyed on key). Payloads are
 * stored as JSONB.
 *
 * Hash stability: a ledger entry's canonical hash is computed with `undefined` fields pruned.
 * `JSON.stringify` (which the driver uses to serialize a JS object into JSONB) drops `undefined`
 * properties, so a round-trip through Postgres reproduces the exact object the hash was taken over —
 * the same guarantee Mongo gets from `ignoreUndefined: true`.
 *
 * The connection string carries credentials, so it only ever comes from the environment.
 */
export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    // One statement per call; `IF NOT EXISTS` makes init idempotent across restarts.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        web3_id TEXT PRIMARY KEY,
        card    JSONB NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        seq   BIGINT PRIMARY KEY,
        entry JSONB NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value JSONB
      )`);
  }

  async loadSetting<T = unknown>(key: string): Promise<T | null> {
    const { rows } = await this.pool.query<{ value: T }>(
      'SELECT value FROM settings WHERE key = $1',
      [key],
    );
    return rows.length ? (rows[0]!.value as T) : null;
  }

  async saveSetting(key: string, value: unknown): Promise<void> {
    // `pg` serializes the JS value to JSONB via JSON.stringify. Wrap in JSON.stringify ourselves so
    // arrays/scalars are stored as-is rather than being treated as SQL arrays/params.
    await this.pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value ?? null)],
    );
  }

  async loadAgents(): Promise<AgentCard[]> {
    const { rows } = await this.pool.query<{ card: AgentCard }>('SELECT card FROM agents');
    return rows.map((r) => r.card);
  }

  async saveAgent(card: AgentCard): Promise<void> {
    await this.pool.query(
      `INSERT INTO agents (web3_id, card) VALUES ($1, $2::jsonb)
       ON CONFLICT (web3_id) DO UPDATE SET card = EXCLUDED.card`,
      [card.web3Id, JSON.stringify(card)],
    );
  }

  async loadLedger(): Promise<LedgerEntry[]> {
    const { rows } = await this.pool.query<{ entry: LedgerEntry }>(
      'SELECT entry FROM ledger_entries ORDER BY seq ASC',
    );
    return rows.map((r) => r.entry);
  }

  async appendEntry(entry: LedgerEntry): Promise<void> {
    // `seq` is the primary key, so a re-append of the same entry is a no-op rather than a crash —
    // safe under gossip/replication that may re-deliver an entry the node already has.
    await this.pool.query(
      `INSERT INTO ledger_entries (seq, entry) VALUES ($1, $2::jsonb)
       ON CONFLICT (seq) DO NOTHING`,
      [entry.seq, JSON.stringify(entry)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
