import { DEFAULT_CURRENCY } from '@web3/core';
import type { Amount, Currency, Wallet, Web3Id } from '@web3/core';
import { fromB64u, signString, verifyString } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import {
  type EntryData,
  type EntryType,
  GENESIS_HASH,
  type LedgerEntry,
  type MessageData,
  hashEntry,
} from './entry.js';

export interface LedgerSnapshot {
  publicKey: string;
  entries: LedgerEntry[];
}

export interface VerifyReport {
  ok: boolean;
  entries: number;
  /** Index of the first broken entry, or -1 if the whole chain is intact. */
  brokenAt: number;
  reason?: string;
}

export class InsufficientFundsError extends Error {
  constructor(
    public readonly account: Web3Id,
    public readonly balance: Amount,
    public readonly required: Amount,
  ) {
    super(`Insufficient funds: ${account} has ${balance} but ${required} is required`);
    this.name = 'InsufficientFundsError';
  }
}

/**
 * The Web3.0 ledger: an append-only, hash-linked log whose every entry is signed by the node
 * authority with a post-quantum (ML-DSA) signature. Wallet balances are derived from the log,
 * so the log is the single source of truth and `verifyChain()` can prove it was never altered.
 *
 * This MVP ledger is a *verifiable signed log*, not a distributed L1 — see docs/QUANTUM.md.
 */
export class Ledger {
  private readonly entries: LedgerEntry[] = [];
  private readonly balances = new Map<Web3Id, Wallet>();

  /**
   * Synchronous, in-memory side effect for every newly-appended entry (e.g. the network-account
   * index). Runs inline during `append()`. Durable persistence is separate — see `onPersist`.
   */
  onAppend?: (entry: LedgerEntry) => void;

  /**
   * Durable-write hook for every newly-appended entry. Unlike `onAppend`, this returns a promise
   * and runs through a **serialized, retrying queue**: writes are awaited in seq order (never
   * concurrent, never reordered), and a transient failure is retried before the next entry lands.
   * This closes the gap that a fire-and-forget write-behind left — a dropped or out-of-order write
   * could persist a hole (missing seq) that breaks the hash chain on the next restart. Await
   * `flush()` at a commit boundary to guarantee everything appended so far is on disk.
   */
  onPersist?: (entry: LedgerEntry) => Promise<void>;

  /** Notified once when the persistence queue gives up on an entry (retries exhausted). */
  onPersistError?: (entry: LedgerEntry, err: Error) => void;

  /** Serialized tail of the persistence queue — each write chains onto this, in seq order. */
  private persistTail: Promise<void> = Promise.resolve();
  /** A fatal, unrecoverable persistence failure (retries exhausted). Surfaced by `flush()`. */
  private persistFailure?: Error;
  private readonly persistRetryDelaysMs: number[];

  constructor(
    private readonly keys: Keypair,
    private readonly publicKeyB64u: string,
    private readonly now: () => string = () => new Date().toISOString(),
    opts: { persistRetryDelaysMs?: number[] } = {},
  ) {
    // Backoff schedule for a failing durable write (a DB blip). Length = max retries; a store that
    // is genuinely down eventually exhausts these and the failure surfaces through `flush()`.
    this.persistRetryDelaysMs = opts.persistRetryDelaysMs ?? [100, 300, 1000, 3000, 8000];
  }

  /**
   * Load previously-persisted entries on startup, rebuilding wallet balances by replaying them.
   * Entries keep their original signatures (they are not re-signed). Verifies the chain and
   * throws if the persisted log is inconsistent, so a corrupted store can't silently boot.
   */
  hydrate(entries: LedgerEntry[]): void {
    if (this.entries.length > 0) throw new Error('hydrate() must run before any writes');
    const report = verifyEntries(this.keys.publicKey, entries);
    if (!report.ok) {
      throw new Error(
        `refusing to hydrate a broken ledger: ${report.reason} at #${report.brokenAt}`,
      );
    }
    for (const entry of entries) {
      this.entries.push(entry);
      this.replayBalances(entry);
    }
  }

  private replayBalances(entry: LedgerEntry): void {
    if (entry.type === 'register') {
      const d = entry.data as { web3Id: Web3Id; openingBalance: Amount; currency: Currency };
      if (!this.balances.has(d.web3Id)) {
        this.balances.set(d.web3Id, { owner: d.web3Id, currency: d.currency, balance: 0 });
      }
      this.credit(d.web3Id, d.openingBalance, d.currency);
    } else if (entry.type === 'payment') {
      const d = entry.data as {
        from: Web3Id | null;
        to: Web3Id;
        amount: Amount;
        currency: Currency;
      };
      if (d.from) this.debit(d.from, d.amount, d.currency);
      this.credit(d.to, d.amount, d.currency);
    }
  }

  /** Register an account, optionally crediting an opening balance (a faucet grant). */
  register(
    web3Id: Web3Id,
    did: string,
    openingBalance: Amount = 0,
    currency: Currency = DEFAULT_CURRENCY,
  ): LedgerEntry<'register'> {
    if (!this.balances.has(web3Id)) {
      this.balances.set(web3Id, { owner: web3Id, currency, balance: 0 });
    }
    const entry = this.append('register', { web3Id, did, openingBalance, currency });
    this.credit(web3Id, openingBalance, currency);
    return entry;
  }

  /** Move `amount` from one wallet to another. Throws if the sender can't cover it. */
  transfer(
    from: Web3Id,
    to: Web3Id,
    amount: Amount,
    opts: { memo?: string; taskId?: string; currency?: Currency; nonce?: number } = {},
  ): LedgerEntry<'payment'> {
    const currency = opts.currency ?? DEFAULT_CURRENCY;
    const balance = this.balanceOf(from);
    if (balance < amount) throw new InsufficientFundsError(from, balance, amount);
    const entry = this.append('payment', {
      from,
      to,
      amount,
      currency,
      memo: opts.memo,
      taskId: opts.taskId,
      nonce: opts.nonce,
    });
    this.debit(from, amount, currency);
    this.credit(to, amount, currency);
    return entry;
  }

  /**
   * Bind an account's address to the public key that authorises its transactions. Appended as a
   * replicated `account` entry so every node learns the key from the chain (see AccountData). No
   * balance effect — the opening faucet grant is a separate mint.
   */
  bindAccount(web3Id: Web3Id, role: string, pubkey: string, did: string): LedgerEntry<'account'> {
    return this.append('account', { web3Id, role, pubkey, did });
  }

  /**
   * Mint new credits into an account (faucet / block reward / contribution reward). `from` is null
   * on the resulting entry. An optional `memo` labels the mint on-chain (e.g. a contribution-reward
   * epoch tag) so it is self-describing and auditable.
   */
  mint(
    to: Web3Id,
    amount: Amount,
    currency: Currency = DEFAULT_CURRENCY,
    memo?: string,
  ): LedgerEntry<'payment'> {
    const entry = this.append('payment', { from: null, to, amount, currency, memo });
    this.credit(to, amount, currency);
    return entry;
  }

  /** Record the provenance (hash only) of a routed message. */
  recordMessage(data: MessageData): LedgerEntry<'message'> {
    return this.append('message', data);
  }

  balanceOf(web3Id: Web3Id): Amount {
    return this.balances.get(web3Id)?.balance ?? 0;
  }

  getWallet(web3Id: Web3Id): Wallet | undefined {
    const wallet = this.balances.get(web3Id);
    return wallet ? { ...wallet } : undefined;
  }

  wallets(): Wallet[] {
    return [...this.balances.values()].map((w) => ({ ...w }));
  }

  all(): LedgerEntry[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }

  head(): string {
    return this.entries.at(-1)?.hash ?? GENESIS_HASH;
  }

  /**
   * Recompute every hash, confirm each entry links to its predecessor, and verify the node's
   * post-quantum signature on each. Returns where (if anywhere) the chain was broken.
   */
  verifyChain(): VerifyReport {
    return verifyEntries(this.keys.publicKey, this.entries);
  }

  /** Cached by entry count: the last full verification, kept in `_verifyCache`. */
  private _verifyCache?: { size: number; report: VerifyReport };

  /**
   * Like `verifyChain()`, but memoised by entry count: the append-only log only ever grows, so a
   * cached result stays valid until a new entry lands. This makes hot, frequently-polled paths
   * (`/health`, `/stats`) O(1) instead of re-verifying every ML-DSA signature on each request —
   * which otherwise pegs a CPU on a large chain. A fresh append invalidates the cache naturally.
   */
  verifyChainCached(): VerifyReport {
    if (this._verifyCache && this._verifyCache.size === this.entries.length) {
      return this._verifyCache.report;
    }
    const report = verifyEntries(this.keys.publicKey, this.entries);
    this._verifyCache = { size: this.entries.length, report };
    return report;
  }

  toJSON(): LedgerSnapshot {
    return { publicKey: this.publicKeyB64u, entries: this.all() };
  }

  private append<T extends EntryType>(type: T, data: EntryData[T]): LedgerEntry<T> {
    // Drop `undefined`-valued fields (e.g. an unset payment memo) so the entry's in-memory,
    // hashed, and persisted forms are byte-identical. Without this a store that serialises
    // `undefined` as `null` (MongoDB does) would round-trip an entry into one whose recomputed
    // hash no longer matches — breaking `verifyChain()`/`hydrate()` on the next restart.
    const core = {
      seq: this.entries.length,
      ts: this.now(),
      prevHash: this.head(),
      type,
      data: pruneUndefined(data),
    };
    const hash = hashEntry(core);
    const entry: LedgerEntry<T> = {
      ...core,
      hash,
      signature: signString(this.keys.secretKey, hash),
    };
    this.entries.push(entry);
    this.onAppend?.(entry);
    this.enqueuePersist(entry);
    return entry;
  }

  /**
   * Chain this entry's durable write onto the serialized persistence queue. Because every write
   * `.then`s off the previous one, they run strictly in seq order and never overlap — so the store
   * can never receive entry N+1 before N, and a transient failure is retried (below) before the
   * next write proceeds. This is the structural guarantee against a persisted seq-gap.
   */
  private enqueuePersist(entry: LedgerEntry): void {
    const persist = this.onPersist;
    if (!persist) return;
    this.persistTail = this.persistTail.then(() => this.persistWithRetry(persist, entry));
  }

  private async persistWithRetry(
    persist: (entry: LedgerEntry) => Promise<void>,
    entry: LedgerEntry,
  ): Promise<void> {
    // Already given up on an earlier entry: the chain is already holed, so don't pile writes on top
    // of a gap. `flush()` will surface the original failure to the caller.
    if (this.persistFailure) return;
    for (let attempt = 0; ; attempt++) {
      try {
        await persist(entry);
        return;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (attempt >= this.persistRetryDelaysMs.length) {
          this.persistFailure = error;
          this.onPersistError?.(entry, error);
          return;
        }
        await sleep(this.persistRetryDelaysMs[attempt]!);
      }
    }
  }

  /**
   * Resolve once every entry appended so far is durably persisted; reject if persistence has
   * permanently failed. Await this at a durability boundary (a committed block, process shutdown)
   * so the in-memory chain never advances past the store in a way a crash could turn into a gap.
   */
  async flush(): Promise<void> {
    await this.persistTail;
    if (this.persistFailure) throw this.persistFailure;
  }

  /**
   * Apply the balance effects of a FOREIGN entry (proposed by a peer, committed in a block) without
   * appending it to this node's signed local log. This is the state-replication half of the chain:
   * blocks order every node's entries; applying them here converges balances across the network.
   * The caller is responsible for dedupe (apply each foreign entry exactly once).
   */
  applyExternal(entry: LedgerEntry): void {
    this.replayBalances(entry);
  }

  private credit(web3Id: Web3Id, amount: Amount, currency: Currency): void {
    const wallet = this.balances.get(web3Id) ?? { owner: web3Id, currency, balance: 0 };
    wallet.balance += amount;
    this.balances.set(web3Id, wallet);
  }

  private debit(web3Id: Web3Id, amount: Amount, currency: Currency): void {
    const wallet = this.balances.get(web3Id) ?? { owner: web3Id, currency, balance: 0 };
    wallet.balance -= amount;
    this.balances.set(web3Id, wallet);
  }
}

/**
 * Return a copy of `value` with every `undefined`-valued key removed, matching exactly what
 * `JSON.stringify` (and therefore `canonicalize`) keeps. This is the shape we hash, store, and
 * hold in memory, so all three agree regardless of how a store serialises `undefined`.
 */
function pruneUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Backoff delay for the persistence retry queue. Unref'd so a pending retry never holds the process open. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

/**
 * Verify a list of entries against a signing public key — the shared logic behind
 * `Ledger.verifyChain()` and `verifySnapshot()`. Checks hash links, content integrity, and the
 * post-quantum signature on every entry.
 */
export function verifyEntries(
  publicKey: Uint8Array,
  entries: readonly LedgerEntry[],
): VerifyReport {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.prevHash !== prevHash) {
      return { ok: false, entries: entries.length, brokenAt: i, reason: 'broken hash link' };
    }
    if (hashEntry(entry) !== entry.hash) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: i,
        reason: 'entry hash mismatch (tampered content)',
      };
    }
    if (!verifyString(publicKey, entry.hash, entry.signature)) {
      return { ok: false, entries: entries.length, brokenAt: i, reason: 'invalid node signature' };
    }
    prevHash = entry.hash;
  }
  return { ok: true, entries: entries.length, brokenAt: -1 };
}

/**
 * Verify a persisted/exported ledger snapshot. This is how an auditor (or the demo's
 * tamper-check) confirms an on-disk ledger was never altered — mutate any entry and this flips
 * to `ok: false` with the exact `brokenAt` index.
 */
export function verifySnapshot(snapshot: LedgerSnapshot): VerifyReport {
  return verifyEntries(fromB64u(snapshot.publicKey), snapshot.entries);
}
