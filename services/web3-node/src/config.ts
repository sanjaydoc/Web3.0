/** All Web3.0 modules that ship with the node. Disable any by removing it from `config.modules`. */
export const ALL_MODULES = [
  'naming',
  'accounts',
  'registry',
  'messaging',
  'payments',
  'guardrails',
  'observability',
  'consensus',
  'telegram',
  'hosted',
  'operator',
] as const;

export type ModuleName = (typeof ALL_MODULES)[number];

export interface GuardrailConfig {
  /** Max total spend (minor units) an agent may send within a window. */
  spendCapPerWindow: number;
  /** Max messages an agent may send within a window. */
  rateLimitPerWindow: number;
  /** Rolling window length in milliseconds. */
  windowMs: number;
}

export interface AuthConfig {
  /** When true, reject bad signatures / replays / rate-limit breaches. When false, log but allow
   * ("warn-only") — useful while migrating clients. Either way the decision is recorded. */
  enforce: boolean;
  /** Max age of a signed envelope's timestamp before it's rejected as stale (ms). */
  freshnessMs: number;
  /** Allowed clock skew for envelopes dated slightly in the future (ms). */
  clockSkewMs: number;
  /** Max HTTP requests per client IP per window (0 disables HTTP rate limiting). */
  httpRateLimitPerWindow: number;
  /** Rolling window length for the HTTP rate limiter (ms). */
  httpRateWindowMs: number;
}

/** How payments settle value. `internal` = the Web3.0 ledger is the source of truth (default).
 * `simulated` = mimic an on-chain stablecoin transfer (fake tx refs, no chain). `testnet` = build a
 * real ERC-20 transfer against an EVM testnet RPC (no broadcast without a funded signing key). */
export type SettlementMode = 'internal' | 'simulated' | 'testnet';

export interface SettlementConfig {
  mode: SettlementMode;
  /** EVM JSON-RPC endpoint for `testnet` mode (e.g. a Base/Sepolia RPC URL). */
  rpcUrl?: string;
  /** ERC-20 token contract address to settle in (a testnet USDC), for `testnet` mode. */
  tokenAddress?: string;
  /** Human-readable network label shown on receipts (e.g. `base-sepolia`). */
  network: string;
  /** Token decimals for display / minor-unit conversion. */
  decimals: number;
  /** Optional block-explorer base URL to build a tx link on receipts. */
  explorerBaseUrl?: string;
}

/** Distributed L1: `off` runs a solo node (default); `poa` joins a proof-of-authority block chain. */
export type ConsensusMode = 'off' | 'poa';

export interface ConsensusConfig {
  mode: ConsensusMode;
  /** Ordered base64url authority public keys (the round-robin proposer set). This node's own key
   * must be in the set to propose. Empty → this node is the sole authority. */
  authorities: string[];
  /** Peer node base URLs to gossip blocks with (e.g. http://host:8788). */
  peers: string[];
  /** How often (ms) to attempt to propose a block when it's this node's turn. */
  blockMs: number;
  /** An authority's slot length (ms): if it doesn't produce within a slot, the next may step in
   * (proposer-skip), so one offline node doesn't stall the chain. 0 disables skipping. */
  slotMs: number;
}

/** Operator incentives — how running a node earns aETH. All default to 0 (off). */
export interface FeesConfig {
  /** Protocol fee on each payment, in basis points, skimmed from the payee to the node treasury. */
  protocolBps: number;
  /** aETH minted to a block's proposer as a reward (only when this node proposes). */
  blockReward: number;
  /** Local part of the node's treasury Web3.0 ID that collects earnings. */
  treasuryLocal: string;
}

export interface Web3Config {
  host: string;
  port: number;
  /** Which modules the kernel loads, in order. Web3.0 is module-first: add/remove freely. */
  modules: ModuleName[];
  /** Opening balance minted to every new account (a testnet faucet). */
  faucetGrant: number;
  guardrails: GuardrailConfig;
  auth: AuthConfig;
  settlement: SettlementConfig;
  consensus: ConsensusConfig;
  fees: FeesConfig;
  /** MongoDB connection string. When set, state persists across restarts; else in-memory. */
  mongodbUri?: string;
  /** Database name to use within the MongoDB cluster. */
  mongodbDb: string;
}

// Back-compat shim: the config vars were renamed ACP_* → WEB3_*. Any legacy ACP_* var still in the
// environment (e.g. an older local .env) is mirrored to its WEB3_* name if that isn't already set,
// so existing setups keep working without editing .env. Runs once at import, before config is read.
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('ACP_') && v !== undefined) {
    const renamed = `WEB3_${k.slice(4)}`;
    if (process.env[renamed] === undefined) process.env[renamed] = v;
  }
}

/** Read a boolean env var: "0", "false", "no", "off" (case-insensitive) are false; unset → fallback. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

export const DEFAULT_CONFIG: Web3Config = {
  host: process.env.WEB3_HOST ?? '127.0.0.1',
  port: Number(process.env.WEB3_PORT ?? 8787),
  modules: [...ALL_MODULES],
  faucetGrant: Number(process.env.WEB3_FAUCET ?? 100_000), // 1,000.00 aETH
  guardrails: {
    spendCapPerWindow: Number(process.env.WEB3_SPEND_CAP ?? 500_000), // 5,000.00 aETH
    rateLimitPerWindow: Number(process.env.WEB3_RATE_LIMIT ?? 120),
    windowMs: Number(process.env.WEB3_WINDOW_MS ?? 60_000),
  },
  auth: {
    enforce: envBool('WEB3_AUTH_ENFORCE', true),
    freshnessMs: Number(process.env.WEB3_AUTH_FRESHNESS_MS ?? 120_000), // 2 minutes
    clockSkewMs: Number(process.env.WEB3_AUTH_CLOCK_SKEW_MS ?? 5_000),
    httpRateLimitPerWindow: Number(process.env.WEB3_HTTP_RATE_LIMIT ?? 600),
    httpRateWindowMs: Number(process.env.WEB3_HTTP_RATE_WINDOW_MS ?? 60_000),
  },
  settlement: {
    mode: (process.env.WEB3_SETTLEMENT as SettlementMode) || 'internal',
    rpcUrl: process.env.WEB3_SETTLEMENT_RPC_URL,
    tokenAddress: process.env.WEB3_SETTLEMENT_TOKEN,
    network: process.env.WEB3_SETTLEMENT_NETWORK ?? 'web3-ledger',
    decimals: Number(process.env.WEB3_SETTLEMENT_DECIMALS ?? 2),
    explorerBaseUrl: process.env.WEB3_SETTLEMENT_EXPLORER,
  },
  consensus: {
    mode: (process.env.WEB3_CONSENSUS as ConsensusMode) || 'off',
    authorities: csv(process.env.WEB3_AUTHORITIES),
    peers: csv(process.env.WEB3_PEERS),
    blockMs: Number(process.env.WEB3_BLOCK_MS ?? 3_000),
    slotMs: Number(process.env.WEB3_SLOT_MS ?? 6_000),
  },
  fees: {
    protocolBps: Number(process.env.WEB3_FEE_BPS ?? 0),
    blockReward: Number(process.env.WEB3_BLOCK_REWARD ?? 0),
    treasuryLocal: process.env.WEB3_TREASURY ?? 'treasury',
  },
  mongodbUri: process.env.WEB3_MONGODB_URI,
  mongodbDb: process.env.WEB3_MONGODB_DB ?? 'web3',
};

/** Parse a comma-separated env var into a trimmed, non-empty list. */
function csv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
