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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
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
};

export function formatAmount(minor: number, currency = 'aUSD'): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}
