import { DEFAULT_CURRENCY } from '@acp/core';
import type { Amount, Currency, Wallet, Web3Id } from '@acp/core';
import { fromB64u, signString, verifyString } from '@acp/crypto';
import type { Keypair } from '@acp/crypto';
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
 * The ACP ledger: an append-only, hash-linked log whose every entry is signed by the node
 * authority with a post-quantum (ML-DSA) signature. Wallet balances are derived from the log,
 * so the log is the single source of truth and `verifyChain()` can prove it was never altered.
 *
 * This MVP ledger is a *verifiable signed log*, not a distributed L1 — see docs/QUANTUM.md.
 */
export class Ledger {
  private readonly entries: LedgerEntry[] = [];
  private readonly balances = new Map<Web3Id, Wallet>();

  /** Called after every newly-appended entry — the write-through hook for persistence. */
  onAppend?: (entry: LedgerEntry) => void;

  constructor(
    private readonly keys: Keypair,
    private readonly publicKeyB64u: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

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
    opts: { memo?: string; taskId?: string; currency?: Currency } = {},
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
    });
    this.debit(from, amount, currency);
    this.credit(to, amount, currency);
    return entry;
  }

  /** Mint new credits into an account (faucet). `from` is null on the resulting entry. */
  mint(to: Web3Id, amount: Amount, currency: Currency = DEFAULT_CURRENCY): LedgerEntry<'payment'> {
    const entry = this.append('payment', { from: null, to, amount, currency });
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
    return entry;
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
