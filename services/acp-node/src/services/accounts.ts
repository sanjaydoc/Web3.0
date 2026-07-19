import { createHash, randomBytes } from 'node:crypto';
import { web3Id as makeWeb3Id } from '@acp/core';
import type { Store } from '../store/index.js';

/** The three roles the node enforces. `admin` runs the node; `developer` publishes dApps; `operator` hosts. */
export type Role = 'admin' | 'operator' | 'developer';
export const ROLES: Role[] = ['admin', 'operator', 'developer'];

/** A user account: a human address + role + a hashed API token. The raw token is shown once, at signup. */
export interface Account {
  address: string; // e.g. sanjay@web3.0
  role: Role;
  tokenHash: string; // sha256(token) — the raw token is never stored
  createdAt: string;
}

/** What a caller learns about themselves — never the token hash. */
export interface AccountView {
  address: string;
  role: Role;
  createdAt: string;
}

const SETTING_KEY = 'accounts';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * accounts — the sign-up + authentication backbone. Each account gets a human address
 * (`local@web3.0`) and an `ACP_TOKEN` (a random API token). The token is returned exactly once and
 * stored only as a hash; presenting it later authenticates the account and resolves its role.
 * Persisted in the Store so accounts survive restarts.
 */
export class AccountsService {
  private readonly byAddress = new Map<string, Account>();
  private readonly byTokenHash = new Map<string, Account>();

  constructor(
    private readonly store: Store,
    private readonly clock: () => string,
  ) {}

  async load(): Promise<void> {
    const saved = (await this.store.loadSetting<Account[]>(SETTING_KEY)) ?? [];
    for (const a of saved) this.index(a);
  }

  private index(a: Account): void {
    this.byAddress.set(a.address, a);
    this.byTokenHash.set(a.tokenHash, a);
  }

  private async persist(): Promise<void> {
    await this.store.saveSetting(SETTING_KEY, [...this.byAddress.values()]);
  }

  hasAccounts(): boolean {
    return this.byAddress.size > 0;
  }

  hasAdmin(): boolean {
    return [...this.byAddress.values()].some((a) => a.role === 'admin');
  }

  view(a: Account): AccountView {
    return { address: a.address, role: a.role, createdAt: a.createdAt };
  }

  /** Resolve an account from a raw token, or null if it doesn't match any. */
  authenticate(token: string | undefined): Account | null {
    if (!token) return null;
    return this.byTokenHash.get(sha256(token)) ?? null;
  }

  get(address: string): Account | undefined {
    return this.byAddress.get(address);
  }

  list(): AccountView[] {
    return [...this.byAddress.values()].map((a) => this.view(a));
  }

  /**
   * Create an account. Returns the address, role, and the one-time raw token.
   * Throws on an invalid handle, a taken address, or a bad role.
   */
  async signup(local: string, role: Role): Promise<{ address: string; role: Role; token: string }> {
    if (!ROLES.includes(role)) throw new Error(`invalid role: ${role}`);
    const address = makeWeb3Id(local); // throws on a bad handle → caller maps to 400
    if (this.byAddress.has(address)) throw new Error(`${address} is already taken`);
    const token = `acp_${randomBytes(24).toString('base64url')}`;
    const account: Account = { address, role, tokenHash: sha256(token), createdAt: this.clock() };
    this.index(account);
    await this.persist();
    return { address, role, token };
  }
}
