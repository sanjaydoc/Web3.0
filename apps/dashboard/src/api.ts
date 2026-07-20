// Thin typed client for the Web3.0 node's observability endpoints.

export const NODE_URL =
  (import.meta.env.VITE_WEB3_URL as string | undefined) ?? 'http://127.0.0.1:8787';

export interface AgentCard {
  web3Id: string;
  did: string;
  name: string;
  description: string;
  kind: string;
  skills: { id: string; name: string; description: string; tags: string[] }[];
  pricing?: { perTask: number; currency: string };
  createdAt: string;
}

export interface Wallet {
  owner: string;
  currency: string;
  balance: number;
}

export interface Web3Event {
  id: string;
  ts: string;
  kind: string;
  actor?: string;
  target?: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface LedgerEntry {
  seq: number;
  ts: string;
  type: string;
  hash: string;
  data: Record<string, unknown>;
}

export interface Stats {
  agents: number;
  online: number;
  ledgerEntries: number;
  ledgerVerified: boolean;
  totalValue: number;
  totalValueFormatted: string;
}

export interface Guardrails {
  policies: string[];
  config: { spendCapPerWindow: number; rateLimitPerWindow: number; windowMs: number };
}

export interface TelegramStatus {
  enabled: boolean;
  running: boolean;
  tokenSet: boolean;
  tokenHint: string | null;
  botUsername: string | null;
  botLocal: string;
  skill: string;
  bridgeId: string;
  lastError: string | null;
  adminRequired: boolean;
}

export interface SettlementInfo {
  mode: string;
  network: string;
  description: string;
}

export interface HostedAgent {
  handle: string;
  web3Id: string;
  name: string;
  description: string;
  skill: string;
  price: number;
  provider: string;
  model: string;
  kind: 'llm' | 'webhook';
  hasKey: boolean;
  running: boolean;
  createdBy: string;
  connectors: string[];
  createdAt: string;
  webhookUrl?: string;
  did: string;
  walletBalance: number;
}

export interface HostedLaunchConfig {
  handle: string;
  name: string;
  description: string;
  skillId: string;
  skillName: string;
  skillDesc: string;
  price: number;
  provider: string;
  model: string;
  apiKey?: string;
  system?: string;
  webhookUrl?: string;
  createdBy?: string;
  connectors?: string[];
}

export interface NodeInfo {
  name: string;
  description: string;
  version: string;
  modules: string[];
  nodePublicKey: string;
}

export interface NodeLimits {
  contribute: boolean;
  maxRamMb: number;
  maxAgents: number;
}

export type NodeRole = 'solo' | 'relay' | 'authority';

export interface NodeOperator {
  role: NodeRole;
  nodePublicKey?: string;
  treasuryId: string;
  uptimeSec: number;
  earnings: { balance: number; fees: number; rewards: number; formatted: string };
  traffic: { agents: number; online: number; ledgerEntries: number };
  consensus: {
    mode: string;
    authorities: number;
    height: number;
    peers: number;
    isMyTurn: boolean;
  };
  settlement: { mode: string; network: string };
  resources: {
    uptimeSec: number;
    processRssMb: number;
    heapUsedMb: number;
    systemTotalMb: number;
    systemFreeMb: number;
    cpus: number;
    loadAvg1: number;
  };
  limits: NodeLimits;
}

export type Role = 'admin' | 'operator' | 'developer';
export interface Account {
  address: string;
  role: Role;
  createdAt: string;
}
export interface SignupResult {
  address: string;
  role: Role;
  token: string;
}
export interface SkillDef {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
}
export interface CustomConnector {
  id: string;
  name: string;
  category: string;
  endpoint: string;
  description: string;
  createdBy: string;
  createdAt: string;
}

export interface ConsensusInfo {
  mode: string;
  enabled: boolean;
  authorities: string[];
  height: number;
  head: string;
  proposerNow: string | null;
  isMyTurn: boolean;
  peers: string[];
}

// ── account token (an `web3_…` API token from sign-up), stored in this browser ──
const TOKEN_KEY = 'web3.token';
export function getWeb3Token(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}
export function setWeb3Token(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const t = getWeb3Token();
  return t ? { ...base, 'x-web3-token': t } : base;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, adminToken?: string): Promise<T> {
  const headers = authHeaders({ 'content-type': 'application/json' });
  if (adminToken) headers['x-admin-token'] = adminToken;
  const res = await fetch(`${NODE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function send<T>(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`, {
    method,
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Live monetary policy — GUI-editable by the admin, applies immediately. */
export interface Economics {
  feeBps: number;
  blockReward: number;
  burnBps: number;
  authorityStake: number;
  blockRewardFormatted?: string;
  authorityStakeFormatted?: string;
}

/** Node persistence settings (config-file backed; restart to apply). */
export interface StorageInfo {
  kind: string;
  mongodbDb: string;
  mongodbUriHint: string | null;
  configPath: string | null;
  note: string;
}

/** Staking state for permissionless authority admission (Ethereum-deposit-contract style). */
export interface StakeInfo {
  threshold: number;
  thresholdFormatted: string;
  escrow: string;
  nodePublicKey: string;
  staked: number;
  stakedFormatted: string;
  eligible: boolean;
  isAuthority: boolean;
  walletBalance: number;
}

export interface StakeResult {
  staked: number;
  stakedFormatted: string;
  threshold: number;
  eligible: boolean;
  note: string;
}

/** An operator's request to be promoted into the authority set (admin-approved). */
export interface AuthorityRequest {
  address: string;
  nodePublicKey: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: string;
  decidedBy?: string;
}

/** An operator's self-reported node position on the Network map (opt-in). */
export interface NodeLocation {
  address: string;
  label: string;
  lat: number;
  lon: number;
  updatedAt: string;
}

export const api = {
  info: () => get<NodeInfo>('/'),
  stats: () => get<Stats>('/stats'),
  nodeLocations: () => get<{ locations: NodeLocation[] }>('/operator/locations'),
  stakeInfo: () => get<StakeInfo>('/operator/stake'),
  unstake: () =>
    post<{ amount: number; availableAt: string; removalQueued: boolean; cooldownMs: number }>(
      '/operator/unstake',
      {},
    ),
  economics: () => get<Economics>('/operator/economics'),
  updateEconomics: (patch: Partial<Economics>) => post<Economics>('/operator/economics', patch),
  storageInfo: () => get<StorageInfo>('/operator/storage'),
  saveStorage: (input: { mongodbUri?: string; mongodbDb?: string }) =>
    post<{ saved: boolean; restartRequired: boolean; configPath: string }>(
      '/operator/storage',
      input,
    ),
  collectEarnings: () =>
    post<{ collected: number; collectedFormatted: string; walletBalance: number }>(
      '/operator/collect',
      {},
    ),
  stake: (input: { amount?: number; nodePublicKey?: string }) =>
    post<StakeResult>('/operator/stake', input),
  requestAuthority: () => post<AuthorityRequest>('/operator/authority/request', {}),
  myAuthorityRequest: () => get<{ request: AuthorityRequest | null }>('/operator/authority/mine'),
  authorityRequests: () => get<{ requests: AuthorityRequest[] }>('/operator/authority/requests'),
  decideAuthority: (address: string, action: 'approve' | 'reject') =>
    post<AuthorityRequest>('/operator/authority/decide', { address, action }),
  setNodeLocation: (loc: { lat: number; lon: number; label?: string }) =>
    send<NodeLocation>('PUT', '/operator/location', loc),
  clearNodeLocation: () => send<{ removed: boolean }>('DELETE', '/operator/location'),
  agents: () => get<{ agents: AgentCard[]; count: number }>('/agents'),
  events: (limit = 60) => get<{ events: Web3Event[] }>(`/events?limit=${limit}`),
  ledger: () =>
    get<{
      size: number;
      head: string;
      verify: { ok: boolean };
      wallets: Wallet[];
      entries: LedgerEntry[];
    }>('/ledger?limit=40'),
  guardrails: () => get<Guardrails>('/guardrails'),
  settlement: () => get<SettlementInfo>('/settlement'),
  consensus: () => get<ConsensusInfo>('/consensus'),
  telegram: () => get<TelegramStatus>('/telegram'),
  telegramConfig: (
    patch: { enabled?: boolean; token?: string; botLocal?: string; skill?: string },
    adminToken?: string,
  ) => post<TelegramStatus>('/telegram/config', patch, adminToken),
  telegramStart: (adminToken?: string) => post<TelegramStatus>('/telegram/start', {}, adminToken),
  telegramStop: (adminToken?: string) => post<TelegramStatus>('/telegram/stop', {}, adminToken),
  hosted: () =>
    get<{ agents: HostedAgent[]; adminRequired: boolean; scopedTo: string | null }>('/hosted'),
  hostedLaunch: (config: HostedLaunchConfig, adminToken?: string) =>
    post<HostedAgent>('/hosted/launch', config, adminToken),
  hostedStop: (handle: string, adminToken?: string) =>
    post<{ agents: HostedAgent[] }>('/hosted/stop', { handle }, adminToken),
  signup: (local: string, role: Role) => post<SignupResult>('/accounts/signup', { local, role }),
  me: () => get<Account>('/accounts/me'),
  wallet: (id: string) => get<{ wallet: Wallet }>(`/wallets/${encodeURIComponent(id)}`),
  accounts: () => get<{ accounts: Account[] }>('/accounts'),
  skills: () => get<{ skills: SkillDef[] }>('/skills'),
  createSkill: (input: { id: string; name: string; description?: string }) =>
    post<SkillDef>('/skills', input),
  connectors: () => get<{ connectors: CustomConnector[] }>('/connectors'),
  createConnector: (input: {
    id: string;
    name: string;
    category?: string;
    endpoint?: string;
    description?: string;
  }) => post<CustomConnector>('/connectors', input),
  node: () => get<NodeOperator>('/node'),
  nodeLimits: (patch: Partial<NodeLimits>, adminToken?: string) =>
    post<NodeLimits>('/node/limits', patch, adminToken),
};

export function formatAmount(minor: number, currency = 'aETH'): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}
