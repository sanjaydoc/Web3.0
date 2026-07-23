import type { AgentCard } from '@web3/core';
import type { LedgerEntry } from '@web3/ledger';

/**
 * Durable state for a Web3.0 node. The node keeps fast in-memory structures (registry, ledger,
 * wallet balances) but write-throughs every mutation here and reloads on startup — so restarting
 * the node no longer wipes state.
 *
 * Only two things need persisting: agent cards and ledger entries. Wallet balances are *derived*
 * from the ledger (replayed on startup by `Ledger.hydrate`), so they never need their own storage.
 */
export interface Store {
  readonly kind: 'memory' | 'mongodb' | 'postgres';
  /** Connect / create indexes. Called once before load. */
  init(): Promise<void>;
  loadAgents(): Promise<AgentCard[]>;
  saveAgent(card: AgentCard): Promise<void>;
  /** Ledger entries in append order (ascending `seq`). */
  loadLedger(): Promise<LedgerEntry[]>;
  appendEntry(entry: LedgerEntry): Promise<void>;
  /** Load a named settings blob (e.g. Telegram config), or null if unset. */
  loadSetting<T = unknown>(key: string): Promise<T | null>;
  /** Persist a named settings blob. Used for GUI-managed config that must survive restarts. */
  saveSetting(key: string, value: unknown): Promise<void>;
  /** Flush any pending writes and release resources. */
  close(): Promise<void>;
}
