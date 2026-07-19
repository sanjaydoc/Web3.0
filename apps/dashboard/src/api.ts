// Thin typed client for the ACP node's observability endpoints.

export const NODE_URL =
  (import.meta.env.VITE_ACP_URL as string | undefined) ?? 'http://127.0.0.1:8787';

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

export interface AcpEvent {
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

export interface NodeOperator {
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, adminToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
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

export const api = {
  info: () => get<NodeInfo>('/'),
  stats: () => get<Stats>('/stats'),
  agents: () => get<{ agents: AgentCard[]; count: number }>('/agents'),
  events: (limit = 60) => get<{ events: AcpEvent[] }>(`/events?limit=${limit}`),
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
  hosted: () => get<{ agents: HostedAgent[]; adminRequired: boolean }>('/hosted'),
  hostedLaunch: (config: HostedLaunchConfig, adminToken?: string) =>
    post<HostedAgent>('/hosted/launch', config, adminToken),
  hostedStop: (handle: string, adminToken?: string) =>
    post<{ agents: HostedAgent[] }>('/hosted/stop', { handle }, adminToken),
  node: () => get<NodeOperator>('/node'),
  nodeLimits: (patch: Partial<NodeLimits>, adminToken?: string) =>
    post<NodeLimits>('/node/limits', patch, adminToken),
};

export function formatAmount(minor: number, currency = 'aETH'): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}
