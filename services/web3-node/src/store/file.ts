import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { AgentCard } from '@web3/core';
import type { LedgerEntry } from '@web3/ledger';
import type { Store } from './store.js';

/**
 * File-backed store — durable persistence for a single-process, on-device node (the desktop app and
 * the phone) that has no database but does have a private, update-surviving data directory. It is
 * the answer to "my agents / Telegram config disappear when I close the app": on the phone the only
 * alternative was `MemoryStore` (RAM), so an operator's created agents and hosted-agent config were
 * lost on every restart.
 *
 * Layout in `dir`:
 *   - agents.json   — the registry (array of AgentCard), rewritten atomically on each save
 *   - settings.json — named config blobs (hosted-agents, telegram, storage), rewritten atomically
 *   - ledger.jsonl  — this node's OWN authored entries, appended one JSON object per line
 *
 * A follower (phone/desktop peer) authors almost nothing into its own ledger — its transaction
 * history is rebuilt from the network re-sync — so ledger.jsonl stays tiny; the real value is that
 * AGENTS and SETTINGS survive. Agents/settings are held in memory and written through, so reads are
 * cheap and there is no read-modify-write race. Writes go temp-file → rename so a crash mid-write
 * can never leave a half-written (corrupt) file.
 */
export class FileStore implements Store {
  readonly kind = 'file' as const;
  private readonly agentsFile: string;
  private readonly settingsFile: string;
  private readonly ledgerFile: string;
  private readonly agents = new Map<string, AgentCard>();
  private settings: Record<string, unknown> = {};

  constructor(private readonly dir: string) {
    this.agentsFile = join(dir, 'agents.json');
    this.settingsFile = join(dir, 'settings.json');
    this.ledgerFile = join(dir, 'ledger.jsonl');
  }

  async init(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    for (const card of readJson<AgentCard[]>(this.agentsFile, [])) {
      this.agents.set(card.web3Id, card);
    }
    this.settings = readJson<Record<string, unknown>>(this.settingsFile, {});
  }

  async loadAgents(): Promise<AgentCard[]> {
    return [...this.agents.values()];
  }

  async saveAgent(card: AgentCard): Promise<void> {
    this.agents.set(card.web3Id, card);
    writeJsonAtomic(this.agentsFile, [...this.agents.values()]);
  }

  async loadSetting<T = unknown>(key: string): Promise<T | null> {
    return (this.settings[key] as T) ?? null;
  }

  async saveSetting(key: string, value: unknown): Promise<void> {
    this.settings[key] = value;
    writeJsonAtomic(this.settingsFile, this.settings);
  }

  async loadLedger(): Promise<LedgerEntry[]> {
    let raw = '';
    try {
      if (existsSync(this.ledgerFile)) raw = readFileSync(this.ledgerFile, 'utf8');
    } catch {
      return [];
    }
    const entries: LedgerEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as LedgerEntry);
      } catch {
        /* skip a truncated trailing line (e.g. a crash mid-append) */
      }
    }
    return entries.sort((a, b) => a.seq - b.seq);
  }

  async appendEntry(entry: LedgerEntry): Promise<void> {
    // Appends are already serialized by the ledger's persistence queue, so a plain append is safe
    // and keeps seq order. A trailing partial line from a crash is tolerated by loadLedger above.
    appendFileSync(this.ledgerFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }

  async close(): Promise<void> {}
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    const raw = readFileSync(file, 'utf8').trim();
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Atomic whole-file write: write a temp file then rename over the target (rename is atomic). */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}
