import type { AgentCard } from '@acp/core';
import type { LedgerEntry } from '@acp/ledger';
import type { Store } from './store.js';

/**
 * In-memory store — the default for local dev and tests. It genuinely retains state for the
 * lifetime of the instance, so sharing one MemoryStore across two kernels exercises the full
 * persist-then-reload flow (that's how the restart test works) without needing a database.
 */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private readonly agents = new Map<string, AgentCard>();
  private readonly entries: LedgerEntry[] = [];

  async init(): Promise<void> {}

  async loadAgents(): Promise<AgentCard[]> {
    return [...this.agents.values()];
  }

  async saveAgent(card: AgentCard): Promise<void> {
    this.agents.set(card.web3Id, card);
  }

  async loadLedger(): Promise<LedgerEntry[]> {
    return [...this.entries].sort((a, b) => a.seq - b.seq);
  }

  async appendEntry(entry: LedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async close(): Promise<void> {}
}
