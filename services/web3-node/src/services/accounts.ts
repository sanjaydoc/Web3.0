import { createHash, randomBytes } from 'node:crypto';
import { web3Id as makeWeb3Id } from '@web3/core';
import type { Store } from '../store/index.js';

/**
 * The roles the node enforces. `admin` runs the node; `operator` hosts (contributes RAM, earns hosting
 * fees); `agent-owner` creates/owns agents and pays a host to run them. `operator` and `agent-owner`
 * are the two mutually-exclusive marketplace personas picked at signup.
 *
 * The legacy `developer` role (a dApp publisher) was folded into `agent-owner` — its views now live in
 * the agent-owner dashboard. `normalizeRole` maps any stored/incoming `developer` to `agent-owner`, so
 * old accounts keep working without a data migration.
 */
export type Role = 'admin' | 'operator' | 'agent-owner';
export const ROLES: Role[] = ['admin', 'operator', 'agent-owner'];

/** Coerce a stored/incoming role string to a current Role (legacy `developer` → `agent-owner`). */
export function normalizeRole(role: string | undefined): Role {
  if (role === 'developer') return 'agent-owner';
  return ROLES.includes(role as Role) ? (role as Role) : 'agent-owner';
}

/**
 * Freemium plan (GitHub-for-agents model). `free` — the adoption tier, capped hosting (see
 * `config.freeMaxAgents`); `pro` — paid, higher/uncapped. New accounts start `free`; upgrading is
 * admin-set today and moves to a paid credit purchase once the credits on-ramp ships.
 */
export type Plan = 'free' | 'pro';
export const PLANS: Plan[] = ['free', 'pro'];
export function normalizePlan(plan: string | undefined): Plan {
  return plan === 'pro' ? 'pro' : 'free';
}

/** A user account: a human address + role + plan + a hashed API token. Raw token shown once, at signup. */
export interface Account {
  address: string; // e.g. sanjay@web3.0
  role: Role;
  plan: Plan;
  tokenHash: string; // sha256(token) — the raw token is never stored
  createdAt: string;
}

/** What a caller learns about themselves — never the token hash. */
export interface AccountView {
  address: string;
  role: Role;
  plan: Plan;
  createdAt: string;
}

const SETTING_KEY = 'accounts';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * accounts — the sign-up + authentication backbone. Each account gets a human address
 * (`local@web3.0`) and a `WEB3_TOKEN` (a random API token). The token is returned exactly once and
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
    // Normalize legacy fields so old accounts resolve to current values without a data migration:
    // `developer` role → `agent-owner`, and a missing `plan` → `free`.
    for (const a of saved) {
      this.index({ ...a, role: normalizeRole(a.role), plan: normalizePlan(a.plan) });
    }
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
    return { address: a.address, role: a.role, plan: a.plan, createdAt: a.createdAt };
  }

  /** Set an account's freemium plan (free ↔ pro). Returns the updated view, or null if unknown. */
  async setPlan(address: string, plan: Plan): Promise<AccountView | null> {
    const acct = this.byAddress.get(address);
    if (!acct) return null;
    acct.plan = normalizePlan(plan);
    await this.persist();
    return this.view(acct);
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
    const token = `web3_${randomBytes(24).toString('base64url')}`;
    // New accounts start on the FREE tier (GitHub-for-agents adoption wedge).
    const account: Account = {
      address,
      role,
      plan: 'free',
      tokenHash: sha256(token),
      createdAt: this.clock(),
    };
    this.index(account);
    await this.persist();
    return { address, role, token };
  }

  /**
   * Mirror an account that was actually created on another node (an authority) so that its token
   * still authenticates here. Used by a follower after it forwards a signup upstream: the on-chain
   * identity + faucet come from the authority (via block replication), but the token must resolve
   * locally too. No-op if the address already exists.
   */
  async adopt(address: string, role: Role, token: string, plan: Plan = 'free'): Promise<void> {
    if (this.byAddress.has(address)) return;
    const account: Account = {
      address,
      role: normalizeRole(role),
      plan: normalizePlan(plan),
      tokenHash: sha256(token),
      createdAt: this.clock(),
    };
    this.index(account);
    await this.persist();
  }
}
