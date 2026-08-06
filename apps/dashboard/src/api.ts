// Thin typed client for the Web4.0 node's observability endpoints.

export const NODE_URL =
  (import.meta.env.VITE_WEB3_URL as string | undefined) ??
  // Desktop apps tell the dashboard which local node to talk to (the standard app runs on 8787, the
  // Community "Free Agents" app on 8788 so both can run at once). Falls back to 8787 for local dev.
  (typeof window !== 'undefined'
    ? (window as { web3desktop?: { nodeUrl?: string } }).web3desktop?.nodeUrl
    : undefined) ??
  'http://127.0.0.1:8787';

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
  nodes?: number;
  /** Cumulative agents ever registered on the ledger (idle + online); never decreases. */
  totalAgents?: number;
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
  /** RAM economy: where the body runs — 'local', 'pending' (waiting for a host), or an operator node
   *  key (placed remotely). */
  placement?: string;
  /** RAM economy (operator view): the remote owner this body is hosted FOR (undefined for own agents). */
  hostedForOwner?: string;
}

/** RAM economy — the operator's "Hosting · sell your RAM" summary. */
export interface HostingSummary {
  nodeKey: string;
  serveId: string;
  /** Hosting capacity: total slots (from contributed RAM), used, and free (null = uncapped). */
  capacity: { cap: number; used: number; free: number | null };
  /** Agent bodies this node is hosting for other owners (the RAM it's selling). */
  hosted: HostedAgent[];
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
  /** Built-in office tools to enable (e.g. 'web_search', 'fetch_url'). */
  tools?: string[];
}

/** One message in a Genesis-chat conversation. */
export interface GenesisTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** A selectable choice the brain offers for the next answer. */
export interface GenesisAsk {
  field: string;
  multi?: boolean;
  options?: { value: string; label: string }[];
}

/** A compact view of one of the owner's agents, sent so the brain can edit/test/FAQ against them. */
export interface GenesisAgentBrief {
  handle: string;
  name?: string;
  web3Id?: string;
  description?: string;
  skill?: string;
  priceUsd?: number;
  provider?: string;
  model?: string;
  connectors?: string[];
  running?: boolean;
  // Present only for the agent currently being edited (fetched owner-only) so the brain preserves it.
  skillName?: string;
  skillDesc?: string;
  system?: string;
}

/** An action the brain asks the client to run mid-conversation (today: test an existing agent). */
export interface GenesisAction {
  type: 'test';
  handle: string;
  question: string;
}

/** The launch config the interview accumulates (mirrors HostedLaunchConfig, priced in USD). */
export interface GenesisConfig {
  handle?: string;
  name?: string;
  description?: string;
  skillId?: string;
  skillName?: string;
  skillDesc?: string;
  provider?: string;
  model?: string;
  priceUsd?: number;
  connectors?: string[];
  system?: string;
}

/** One turn's parsed reply from POST /genesis/chat. */
export interface GenesisChatReply {
  reply: string;
  ask?: GenesisAsk | null;
  config: GenesisConfig;
  done: boolean;
  action?: GenesisAction | null;
}

/** The admin-configured brain that powers Genesis chat — read view never leaks the key. */
export interface GenesisBrain {
  configured: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  /** Connectors the Genesis assistant itself may call mid-interview (admin-set, names). */
  connectors: string[];
}

/** The full editable config for one agent (from GET /hosted/config/:handle) — no secrets. */
export interface HostedFullConfig {
  handle: string;
  name: string;
  description: string;
  skillId: string;
  skillName: string;
  skillDesc: string;
  price: number; // minor units
  provider: string;
  model: string;
  system?: string;
  connectors?: string[];
  createdBy?: string;
  webhookUrl?: string;
}

/** A document/link attached to an agent's RAG knowledge base. */
export interface KnowledgeSource {
  id: string;
  kind: 'text' | 'url' | 'file';
  title: string;
  ref?: string;
  chars: number;
  chunkCount: number;
  addedAt: string;
}
/** One retrieved chunk from a knowledge-base query preview. */
export interface KnowledgeHit {
  title: string;
  text: string;
  score: number;
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

/** An account's OWN earnings — what it holds and has received/sent — from `/accounts/me/earnings`. */
export interface MyEarnings {
  address: string;
  role: Role;
  balance: number;
  received: number;
  sent: number;
  txCount: number;
}

export type NodeRole = 'solo' | 'relay' | 'authority';

export interface NodeOperator {
  role: NodeRole;
  nodePublicKey?: string;
  treasuryId: string;
  uptimeSec: number;
  earnings: {
    /** Platform treasury balance (accumulated fee revenue). */
    balance: number;
    /** Fee revenue routed to the treasury. */
    fees: number;
    /** This node's own fee-share wallet balance — its collectable earnings. */
    contribution: number;
    formatted: string;
  };
  /** Node auth posture — including whether this is the admin-only main node. */
  auth?: { accounts: number; hasAdmin: boolean; openMode: boolean; adminOnly: boolean };
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
  /**
   * Community ("Free Agents") tier flag + locked budgets. Present + enabled when the connected node
   * runs the Community desktop installer: the dashboard renders the reduced community experience
   * (fixed 8-view nav, local-Ollama-only Genesis, preconfigured LLM/RAM contribution) purely from this.
   */
  community?: {
    enabled: boolean;
    /** Per-owner free-agent cap DERIVED from the live contributed RAM (floor(ramGb)+1). */
    maxAgents?: number;
    /** Live contributed hosting RAM (MB) — the "Your Agent RAM" dial's current value. */
    ramMb?: number;
    /** Dial floor (MB, 2 GB) and ceiling (MB, 128 GB). */
    minRamMb?: number;
    maxRamMb?: number;
    /** Default LLM RAM tier (MB). */
    llmRamMb?: number;
  };
}

// `operator` (host) and `agent-owner` are the two mutually-exclusive marketplace personas.
// (The legacy `developer` role was folded into `agent-owner`.)
export type Role = 'admin' | 'operator' | 'agent-owner';
// Freemium plan (GitHub-for-agents): `free` (capped hosting) or `pro` (paid, higher limits).
export type Plan = 'free' | 'pro';
export interface Account {
  address: string;
  role: Role;
  plan: Plan;
  createdAt: string;
}
export interface SignupResult {
  address: string;
  role: Role;
  token: string;
}
/** A host offering compute in the marketplace: its per-epoch price and live free capacity. */
export interface MarketHost {
  host: string;
  pricePerEpoch: number;
  capacity: number;
  used: number;
  free: number;
}
/** A hosting rental: an agent-owner pays a host to run `agentId`, billed each epoch. */
export interface Lease {
  id: string;
  owner: string;
  host: string;
  agentId: string;
  pricePerEpoch: number;
  active: boolean;
  createdAt: string;
  epochsBilled: number;
  paidTotal: number;
  /** RAM Reservoir: the EXACT per-epoch charge in USDC minor (a fractional float) when this lease bills
   *  at the global reservoir rate. Present ⇒ use THIS for the rate display, not `pricePerEpoch` (which
   *  rounds a sub-cent rate to 0). Absent ⇒ a legacy per-operator lease priced in whole minor. */
  rateExact?: number;
  /** The host operator's advertised public endpoint (host:port / URL), or undefined when the operator
   *  is relay-only or offline. Resolved server-side from the live heartbeat by the lease's host account. */
  endpoint?: string;
}
export interface SkillDef {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
}
/** A model a node operator hosts and sells inference for (Host-LLM tunnel). `host` is the operator's
 *  address (the tunnel serving id); `model` is the local Ollama tag it runs. */
export interface LlmOffer {
  host: string;
  model: string;
  pricePerMTok: number;
  maxContext: number;
  ramMb: number;
  createdAt: string;
}
/** A hosted model's marketplace trust summary (agent-owner ratings + canary checks). */
export interface RepSummary {
  host: string;
  model: string;
  ratingCount: number;
  avgRating: number;
  canaryPass: number;
  canaryTotal: number;
  score: number;
  verified: boolean;
}
/** A market offer decorated with its reputation summary. */
export interface LlmMarketOffer extends LlmOffer {
  rep: RepSummary;
}
/** A RAM→model tier from the node (drives the "detect RAM → suggest model" button). */
export interface ModelTier {
  minRamMb: number;
  model: string;
  ramMb: number;
  label: string;
}
/** Result of the one-click free-RAM detection on the operator's machine. */
export interface RamDetect {
  systemMb: number;
  freeMb: number;
  recommended: ModelTier | null;
  tiers: ModelTier[];
}
/** A model the operator already pulled locally with Ollama. */
export interface LocalModel {
  name: string;
  sizeMb: number;
}
/** Per-model inference usage on the tunnel — the operator's traffic + earnings row. */
export interface LlmUsageRow {
  owner: string;
  host: string;
  model: string;
  /** The owner's agent that consumed this inference (present on owner-side usage rows). */
  agentId?: string;
  unbilledTokens: number;
  billedTokens: number;
  paidTotal: number;
  /** Cost accrued at the serving price, whether or not it settled (the usage-meter figure). */
  accruedCost: number;
  earnedByHost: number;
}
/** Host-side served-usage row — what THIS node served for others (the operator's earnings view). */
export interface HostServedRow {
  host: string;
  model: string;
  requester: string;
  /** Tokens this host has served for (requester, model). */
  servedTokens: number;
  /** Host's accrued net share at the offered price (0 for a free model); not yet-settled money. */
  accruedEarnings: number;
}
export interface ConnectorHeader {
  key: string;
  value: string;
}

export interface CustomConnector {
  id: string;
  name: string;
  category: string;
  endpoint: string;
  description: string;
  method: 'GET' | 'POST';
  /** Header values are redacted ('••••') by the node — secrets never leave the server. */
  headers: ConnectorHeader[];
  hasBody: boolean;
  createdBy: string;
  createdAt: string;
}

/** A vaulted credential as returned by the node — secret VALUES are withheld (only field names). */
export interface VaultSecret {
  id: string;
  kind: string;
  label: string;
  public: Record<string, string>;
  /** Names of the secret fields that are set (values never returned). */
  secretFields: string[];
  createdAt: string;
  updatedAt: string;
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

// ── account token (an `web4_…` API token from sign-up), stored in this browser ──
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

/**
 * An API failure that carries the HTTP status so callers can tell apart the cases that used to look
 * identical: `status === 0` means the request never reached the node (network down, wrong URL, or a
 * CORS block — the browser rejects `fetch` before any response); `401` means the node answered but
 * rejected the token; other codes carry the node's own error message. This is what lets sign-in say
 * "can't reach the node" vs "token not recognized" instead of one misleading catch-all.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Run a fetch, converting a network/CORS rejection into a status-0 ApiError. */
async function doFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${NODE_URL}${path}`, init);
  } catch {
    throw new ApiError('cannot reach the network node (offline, or blocked by CORS)', 0);
  }
}

async function readError(res: Response, path: string): Promise<never> {
  const detail = await res.json().catch(() => ({}));
  throw new ApiError((detail as { error?: string }).error ?? `${path} → ${res.status}`, res.status);
}

async function get<T>(path: string): Promise<T> {
  const res = await doFetch(path, { headers: authHeaders() });
  if (!res.ok) return readError(res, path);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, adminToken?: string): Promise<T> {
  const headers = authHeaders({ 'content-type': 'application/json' });
  if (adminToken) headers['x-admin-token'] = adminToken;
  const res = await doFetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) return readError(res, path);
  return res.json() as Promise<T>;
}

async function send<T>(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  // Only advertise a JSON body when there IS one — Fastify 400s an empty body sent with
  // `content-type: application/json` (e.g. DELETE /llm/offer/:model carries no body).
  const headers =
    body === undefined ? authHeaders() : authHeaders({ 'content-type': 'application/json' });
  const res = await doFetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return readError(res, path);
  return res.json() as Promise<T>;
}

/** Read a File's bytes as base64 (for binary knowledge uploads — PDF / Word — the node extracts the
 *  text). Chunked so a large file doesn't blow the argument limit of String.fromCharCode(...). */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const isRoutable = (ip: string): boolean => !!ip && !/^(127\.|::1$|0\.0\.0\.0$)/.test(ip);

/**
 * This device's own public IP, detected with zero setup. Order: the node's `/whoami` (the IP as the
 * network sees you — no third party) if it returns a routable address; otherwise a public IP echo
 * service so it still resolves straight from the browser with no node redeploy or command. Returns
 * null if every source fails (offline). Only ever the caller's own IP — nothing about the node.
 */
async function detectDeviceIp(): Promise<string | null> {
  try {
    const r = await get<{ ip: string }>('/whoami');
    if (isRoutable(r.ip)) return r.ip;
  } catch {
    /* node may not expose /whoami — fall through to the public echo below */
  }
  // CORS-enabled public echo services; first success wins.
  for (const url of ['https://api.ipify.org?format=json', 'https://ipv4.icanhazip.com']) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      const ip = text.startsWith('{') ? (JSON.parse(text) as { ip?: string }).ip : text;
      if (ip && isRoutable(ip)) return ip;
    } catch {
      /* try the next source */
    }
  }
  return null;
}

/** Live monetary policy — GUI-editable by the admin, applies immediately. All values are basis
 *  points (100 = 1%). USDC-only: no token issuance, just platform take-rates. */
export interface Economics {
  /** Internal-ledger payment fee, split treasury/serving-node. */
  feeBps: number;
  /** Platform commission on RAM-hosting fees (host keeps the rest). */
  hostingCommissionBps: number;
  /** Platform commission on LLM-tunnel inference fees (host keeps the rest). */
  inferenceCommissionBps: number;
  /** Platform fee on x402 skill calls (0 = non-custodial; not surfaced in the Revenue UI). */
  x402FeeBps: number;
  /** Network ceiling on operator inference price, USDC minor per Mtok. 0 = no cap. */
  maxInferencePriceMTok: number;
  /** RAM Reservoir: admin-set global price for hosted-agent RAM, in **micro-USDC per GB per HOUR**
   *  (1_000_000 = $1.00/GB-hour). Micro-dollar granularity so aggressively low rates (a fraction of
   *  cloud RAM) are expressible, not floored to a whole cent. When > 0 every agent bills this one
   *  network-wide rate; 0 = legacy per-operator pricing. */
  ramPricePerGbHour: number;
}

/** RAM Reservoir snapshot — the pooled compute the coordinator sees + the admin-set global price. */
export interface Reservoir {
  /** Distinct node operators contributing RAM right now. */
  operators: number;
  /** Pooled hosting slots: total = used + free (used = agents placed, free = advertised free capacity). */
  slots: { total: number; used: number; free: number };
  /** Pooled RAM in GB (total slots × RAM-per-agent). */
  ramGb: number;
  ramMbPerAgent: number;
  price: {
    /** Admin-set global price, **micro-USDC per GB-hour** (1_000_000 = $1.00/GB-hour; 0 = legacy
     *  per-operator pricing). Format for humans with `formatGbHourPrice`. */
    perGbHour: number;
    /** Derived per-agent-per-epoch charge (EXACT USDC minor, possibly fractional/sub-cent). Format a
     *  per-hour figure with `ratePerHourPrecise`. */
    perAgentEpoch: number;
    epochMs: number;
  };
}

/** Node persistence settings (config-file backed; restart to apply). */
export interface StorageInfo {
  kind: string;
  mongodbDb: string;
  mongodbUriHint: string | null;
  configPath: string | null;
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

export interface X402Supported {
  kinds: { x402Version: number; scheme: string; network: string }[];
}

/** This node's x402 rail: settle mode, asset/network, and a testnet faucet link (when on a testnet). */
export interface X402Info {
  network: string;
  asset: string;
  settle: 'ledger' | 'upstream';
  live: boolean;
  mode: 'sandbox' | 'live';
  facilitatorUrl: string | null;
  faucetUrl: string | null;
}

/** Result of a sandbox self-test payment fired at your own agent (the onboarding "instant proof"). */
export interface X402SelfTest {
  ok: boolean;
  agent: string;
  skill: string;
  amount: string;
  priceUsd: string;
  asset: string;
  network: string;
  tx: string;
  payer: string;
  note: string;
}
export interface X402Receipt {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  amount: string;
  resource?: string;
  at: string;
  explorerUrl?: string;
}
export interface X402Service {
  web3Id: string;
  skillId: string;
  name: string;
  priceAtomic: string;
  priceUsd: string;
  asset: string;
  network: string;
  payTo: string;
  endpoint: string;
}
export interface Erc8004Root {
  standard: string;
  registry: string;
  agentCount: number;
}
export interface Erc8004Identity {
  agentId: number;
  owner: string;
  agentAddress: string;
  agentDomain: string;
  web3Id?: string;
  did?: string;
  tokenURI: string;
  createdAt: string;
  updatedAt: string;
}
export interface Erc8004Feedback {
  index: number;
  client: string;
  score: number;
  tag1?: string;
  tag2?: string;
  ts: string;
  response?: string;
  revoked?: boolean;
}
export interface Erc8004Reputation {
  summary: {
    agentId: number;
    count: number;
    averageScore: number;
    byTag: Record<string, { count: number; average: number }>;
  };
  earnings: {
    agentId: number;
    totalEarnedAtomic: string;
    paymentCount: number;
    uniquePayers: number;
    lastPaidAt?: string;
    economicScore: number;
  };
  combined: {
    agentId: number;
    feedbackScore: number;
    feedbackCount: number;
    economicScore: number;
    paymentCount: number;
    score: number;
  };
  feedback: Erc8004Feedback[];
}

export const api = {
  info: () => get<NodeInfo>('/'),
  stats: () => get<Stats>('/stats'),
  // x402 — internet-native payments (facilitator + receipts).
  x402Supported: () => get<X402Supported>('/x402/supported'),
  x402Info: () => get<X402Info>('/x402/info'),
  /** Fire a sandbox demo payment at your own agent's skill — the onboarding "your agent earned $X". */
  x402SelfTest: (web3Id: string, skillId: string) =>
    post<X402SelfTest>(`/x402/selftest/${web3Id}/${skillId}`, {}),
  x402Receipts: () => get<{ receipts: X402Receipt[] }>('/x402/receipts'),
  x402Directory: () =>
    get<{ count: number; asset: string; network: string; services: X402Service[] }>(
      '/x402/directory',
    ),
  // ERC-8004 — agent identity, reputation & validation.
  erc8004Root: () => get<Erc8004Root>('/.well-known/erc8004.json'),
  erc8004Agents: () =>
    get<{ registry: string; count: number; agents: Erc8004Identity[] }>('/erc8004/agents'),
  erc8004Reputation: (agentId: number) =>
    get<Erc8004Reputation>(`/erc8004/agents/${agentId}/reputation`),
  erc8004Bind: (agentId: number, agentAddress: string) =>
    post<Erc8004Identity>(`/erc8004/agents/${agentId}/bind`, { agentAddress }),
  nodeLocations: () => get<{ locations: NodeLocation[] }>('/operator/locations'),
  economics: () => get<Economics>('/operator/economics'),
  updateEconomics: (patch: Partial<Economics>) => post<Economics>('/operator/economics', patch),
  /** RAM Reservoir: pooled capacity + operators contributing + the admin-set global price. */
  reservoir: () => get<Reservoir>('/hosting/reservoir'),
  storageInfo: () => get<StorageInfo>('/operator/storage'),
  saveStorage: (input: { mongodbUri?: string; mongodbDb?: string }) =>
    post<{ saved: boolean; restartRequired: boolean; configPath: string }>(
      '/operator/storage',
      input,
    ),
  collectEarnings: () =>
    post<{
      collected: number;
      collectedFormatted: string;
      fromTreasury?: number;
      fromContribution?: number;
      walletBalance: number;
    }>('/operator/collect', {}),
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
  // Pass `account` (a node operator's own address) to scope the ledger to THEIR transactions,
  // served from the full replicated chain so their history survives app restarts. Omit it (admin)
  // for the whole-network view.
  ledger: (account?: string) =>
    get<{
      size: number;
      head: string;
      verify: { ok: boolean };
      wallets: Wallet[];
      entries: LedgerEntry[];
    }>(account ? `/ledger?account=${encodeURIComponent(account)}` : '/ledger?limit=40'),
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
  /** RAM economy: the operator's hosting capacity + the bodies it hosts for others. */
  hostingSummary: () => get<HostingSummary>('/hosted/hosting'),
  hostedLaunch: (config: HostedLaunchConfig, adminToken?: string) =>
    post<HostedAgent>('/hosted/launch', config, adminToken),
  hostedStop: (handle: string, adminToken?: string) =>
    post<{ agents: HostedAgent[] }>('/hosted/stop', { handle }, adminToken),
  hostedStart: (handle: string, adminToken?: string) =>
    post<{ agents: HostedAgent[] }>('/hosted/start', { handle }, adminToken),
  /** Permanently delete a hosted agent you own (or any, as admin). */
  hostedDelete: (handle: string, adminToken?: string) =>
    post<{ agents: HostedAgent[] }>('/hosted/delete', { handle }, adminToken),
  /** Chat/test a hosted agent — relay a question to it and get its reply (owner/admin only). */
  askHosted: (handle: string, question: string) =>
    post<{ output: Record<string, unknown> }>('/hosted/ask', { handle, question }),
  /** The full editable config for one agent (skill fields + system prompt, no secrets) — owner/admin. */
  hostedConfig: (handle: string) =>
    get<{ config: HostedFullConfig }>(`/hosted/config/${encodeURIComponent(handle)}`),
  // Hosting marketplace — hosts sell RAM capacity; agent-owners rent it for their agents.
  hostingMarket: () => get<{ hosts: MarketHost[] }>('/hosting/market'),
  hostingOffer: () => get<{ host: string | null; pricePerEpoch: number }>('/hosting/offer'),
  setHostingOffer: (pricePerEpoch: number) =>
    post<{ host: string; pricePerEpoch: number }>('/hosting/offer', { pricePerEpoch }),
  hostingEndpoint: () => get<{ endpoint: string }>('/hosting/endpoint'),
  setHostingEndpoint: (endpoint: string) =>
    post<{ endpoint: string }>('/hosting/endpoint', { endpoint }),
  rentHost: (agentId: string, mandate?: unknown) =>
    post<Lease>('/hosting/rent', { agentId, mandate }),
  hostingLeases: () => get<{ leases: Lease[]; epochMs: number }>('/hosting/leases'),
  hostingRevenue: () => get<{ host: string; revenue: number }>('/hosting/revenue'),
  // Ledger-derived hosting income + hosted agents (correct on any node, unlike /revenue).
  hostingEarned: () =>
    get<{
      host: string;
      total: number;
      agents: { agentId: string; owner: string; total: number; payments: number; since: number }[];
    }>('/hosting/earned'),
  /** Attach an owner-signed lease mandate authorizing recurring hosting rent for a placed agent. */
  hostingMandate: (agentId: string, mandate: unknown) =>
    post<{ ok: boolean }>('/hosting/mandate', { agentId, mandate }),
  /** RAM economy: the live network-wide hosting picture (operators advertising free capacity). */
  hostingNetwork: () =>
    get<{
      operators: {
        nodeKey: string;
        freeSlots: number;
        account: string | null;
        pricePerEpoch: number;
      }[];
      totals: { operators: number; freeSlots: number };
      epochMs: number;
    }>('/hosting/network'),
  endLease: (id: string) =>
    post<{ ended: boolean }>(`/hosting/lease/${encodeURIComponent(id)}/end`, {}),
  // Host-LLM tunnel — operators host local models and sell inference; owners pick one from the market.
  llmMarket: () => get<{ offers: LlmMarketOffer[] }>('/llm/market'),
  llmOffers: () => get<{ offers: LlmOffer[] }>('/llm/offer'),
  setLlmOffer: (input: {
    model: string;
    pricePerMTok?: number;
    maxContext?: number;
    ramMb?: number;
  }) => post<LlmOffer>('/llm/offer', input),
  removeLlmOffer: (model: string) =>
    send<{ removed: boolean }>('DELETE', `/llm/offer/${encodeURIComponent(model)}`),
  /** Operator self-test: run a one-off completion against a locally hosted model (direct to Ollama). */
  testModel: (model: string, prompt: string) =>
    post<{ answer: string }>('/llm/test', { model, prompt }),
  /** The signed-in operator's inference revenue + per-model traffic (Host LLM tunnel). */
  llmRevenue: () => get<{ host: string; revenue: number; usage: HostServedRow[] }>('/llm/revenue'),
  /** The signed-in agent owner's total inference spend. */
  llmSpend: () => get<{ owner: string; spend: number; accrued: number }>('/llm/spend'),
  llmUsage: () => get<{ owner: string; usage: LlmUsageRow[] }>('/llm/usage'),
  /** Rate a hosted model 1–5 (agent owner → marketplace reputation). */
  rateLlm: (host: string, model: string, score: number) =>
    post<RepSummary>('/llm/rate', { host, model, score }),
  /** Detect this machine's free RAM right now and the model that fits it. */
  llmDetect: () => get<RamDetect>('/llm/detect'),
  /** List models already pulled locally with Ollama on the node's machine. */
  llmLocalModels: () => get<{ available: boolean; models: LocalModel[] }>('/llm/local-models'),
  signup: (local: string, role: Role, pubkey?: string) =>
    post<SignupResult>('/accounts/signup', { local, role, pubkey }),
  /** Bind a transaction-signing key to the signed-in account (enables trustless payments). */
  bindKey: (pubkey: string) =>
    post<{ bound: boolean; address: string }>('/accounts/key', { pubkey }),
  me: () => get<Account>('/accounts/me'),
  /** Set an account's freemium plan (admin) — the manual upgrade path until credits ship. */
  setPlan: (address: string, plan: Plan) => post<Account>('/accounts/plan', { address, plan }),
  /** The caller's OWN IP as the node sees it (their device), not the node's address. */
  whoami: () => get<{ ip: string }>('/whoami'),
  /** Auto-detect this device's public IP with no setup: prefer the node's /whoami, else a public
   *  echo service — so the dashboard can always show it without any command or node redeploy. */
  deviceIp: () => detectDeviceIp(),
  /** The signed-in account's OWN earnings (wallet + income), distinct from the node treasury. */
  myEarnings: () => get<MyEarnings>('/accounts/me/earnings'),
  /** The next nonce this account must sign with, and whether its key is bound on-chain. */
  txNonce: (account: string) =>
    get<{ account: string; nonce: number; bound: boolean; pubkey: string | null }>(
      `/tx/nonce/${encodeURIComponent(account)}`,
    ),
  /** Submit an account-signed transfer to the network (trustless — no node login needed). */
  submitTx: (tx: unknown) => post<{ ok: boolean; hash: string; duplicate: boolean }>('/tx', tx),
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
    method?: 'GET' | 'POST';
    headers?: ConnectorHeader[];
    body?: string;
  }) => post<CustomConnector>('/connectors', input),
  /** Delete a custom connector you created (owner/admin). */
  deleteConnector: (id: string) =>
    send<{ removed: boolean }>('DELETE', `/connectors/${encodeURIComponent(id)}`),

  // Credential vault — per-owner app passwords for office tools (e.g. the email send tool). Secret
  // values are stored server-side and never returned.
  vault: () =>
    get<{ secrets: VaultSecret[]; emailProviders: string[]; caldavProviders: string[] }>('/vault'),
  saveEmailCredential: (input: {
    provider: string;
    user: string;
    pass: string;
    fromName?: string;
    fromEmail?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
  }) => post<VaultSecret>('/vault/email', input),
  saveCalendarCredential: (input: {
    provider: string;
    user: string;
    pass: string;
    serverUrl?: string;
  }) => post<VaultSecret>('/vault/calendar', input),
  deleteVaultSecret: (id: string) =>
    send<{ removed: boolean }>('DELETE', `/vault/${encodeURIComponent(id)}`),
  /** Begin an OAuth connect (e.g. 'google') — returns the consent URL to open in a popup. */
  oauthStart: (provider: string) =>
    post<{ url: string }>(`/oauth/${encodeURIComponent(provider)}/start`, {}),
  node: () => get<NodeOperator>('/node'),
  nodeLimits: (patch: Partial<NodeLimits>, adminToken?: string) =>
    post<NodeLimits>('/node/limits', patch, adminToken),

  // Genesis chat — conversational agent create/edit/test/FAQ (agent-owners), admin-configured brain.
  genesisBrain: () => get<GenesisBrain>('/genesis/brain'),
  setGenesisBrain: (
    patch: {
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
      connectors?: string[];
    },
    adminToken?: string,
  ) =>
    post<{ configured: boolean; provider: string; model: string; connectors: string[] }>(
      '/genesis/brain',
      patch,
      adminToken,
    ),
  genesisChat: (messages: GenesisTurn[], agents?: GenesisAgentBrief[]) =>
    post<GenesisChatReply>('/genesis/chat', { messages, agents }),
  /** Public (unauthenticated) Genesis interview turn — powers the landing-page "create your agent"
   *  widget so a first-time visitor can design an agent before they have an account. Create-only. */
  genesisPublicChat: (messages: GenesisTurn[]) =>
    post<GenesisChatReply>('/genesis/public-chat', { messages }),

  // Knowledge base (RAG) — attach docs + links to an agent so it answers from the owner's data.
  knowledgeSources: (web3Id: string) =>
    get<{ sources: KnowledgeSource[]; embedder?: string }>(
      `/knowledge/${encodeURIComponent(web3Id)}`,
    ),
  addKnowledge: (
    web3Id: string,
    body: {
      kind?: 'text' | 'url' | 'file';
      title?: string;
      text?: string;
      url?: string;
      filename?: string;
      // Base64 of a binary document (PDF / Word .docx) — the node decodes + extracts the text.
      dataBase64?: string;
    },
  ) => post<{ source: KnowledgeSource }>(`/knowledge/${encodeURIComponent(web3Id)}/source`, body),
  removeKnowledge: (web3Id: string, sourceId: string) =>
    send<{ removed: boolean }>(
      'DELETE',
      `/knowledge/${encodeURIComponent(web3Id)}/source/${encodeURIComponent(sourceId)}`,
    ),
  queryKnowledge: (web3Id: string, question: string) =>
    post<{ hits: KnowledgeHit[] }>(`/knowledge/${encodeURIComponent(web3Id)}/query`, { question }),
};

export function formatAmount(minor: number, currency = 'USDC'): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

/** Epochs per hour for a given epoch duration (ms). Falls back to 1 so callers never divide by 0. */
export function epochsPerHour(epochMs: number): number {
  return epochMs && epochMs > 0 ? 3_600_000 / epochMs : 1;
}

/**
 * Render a per-epoch minor-unit rent as a human /hour rate, e.g. "6.00 USDC / hour". Billing stays
 * per-epoch on-chain; this is purely the human-facing display (the epoch is the unit money moves).
 */
export function ratePerHour(pricePerEpoch: number, epochMs: number, currency = 'USDC'): string {
  // Until the node reports epoch duration (older backend), don't mislabel a per-epoch figure as
  // /hour — fall back to the honest /epoch label.
  if (!epochMs || epochMs <= 0) return `${formatAmount(pricePerEpoch, currency)} / epoch`;
  return `${formatAmount(pricePerEpoch * epochsPerHour(epochMs), currency)} / hour`;
}

/**
 * Format a possibly-fractional USDC-minor amount with adaptive precision. RAM Reservoir rates can be a
 * small fraction of a cent, which `formatAmount`'s fixed 2 decimals would flatten to "0.00" — so show
 * more decimals for sub-cent values and the usual 2 for everything ≥ 1¢.
 */
export function formatMinorPrecise(minor: number, currency = 'USDC'): string {
  const usd = minor / 100;
  if (!Number.isFinite(usd) || usd === 0) return `0.00 ${currency}`;
  const abs = Math.abs(usd);
  const decimals = abs >= 0.01 ? 2 : abs >= 0.0001 ? 4 : 6;
  return `${usd.toFixed(decimals)} ${currency}`;
}

/**
 * Like `ratePerHour`, but keeps sub-cent precision — reservoir rates can be a fraction of a cent per
 * hour, which `formatAmount` would round to 0.00. Use for the reservoir's derived per-agent rate.
 */
export function ratePerHourPrecise(
  pricePerEpoch: number,
  epochMs: number,
  currency = 'USDC',
): string {
  if (!epochMs || epochMs <= 0) return `${formatMinorPrecise(pricePerEpoch, currency)} / epoch`;
  return `${formatMinorPrecise(pricePerEpoch * epochsPerHour(epochMs), currency)} / hour`;
}

/**
 * Format a **micro-USDC per GB-hour** price (1_000_000 = $1.00) as a dollar string with adaptive
 * precision, trimming trailing zeros so a $0.0005/GB-hour rate reads cleanly instead of "$0.000500".
 */
export function formatGbHourPrice(micro: number, currency = 'USDC'): string {
  const usd = micro / 1_000_000;
  if (!Number.isFinite(usd) || usd <= 0) return `0 ${currency}`;
  const s = usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} ${currency}`;
}
