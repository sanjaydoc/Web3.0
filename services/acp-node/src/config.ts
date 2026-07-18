/** All ACP modules that ship with the node. Disable any by removing it from `config.modules`. */
export const ALL_MODULES = [
  'naming',
  'registry',
  'messaging',
  'payments',
  'guardrails',
  'observability',
  'consensus',
  'telegram',
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

/** How payments settle value. `internal` = the ACP ledger is the source of truth (default).
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
}

export interface AcpConfig {
  host: string;
  port: number;
  /** Which modules the kernel loads, in order. ACP is module-first: add/remove freely. */
  modules: ModuleName[];
  /** Opening balance minted to every new account (a testnet faucet). */
  faucetGrant: number;
  guardrails: GuardrailConfig;
  auth: AuthConfig;
  settlement: SettlementConfig;
  consensus: ConsensusConfig;
  /** MongoDB connection string. When set, state persists across restarts; else in-memory. */
  mongodbUri?: string;
  /** Database name to use within the MongoDB cluster. */
  mongodbDb: string;
}

/** Read a boolean env var: "0", "false", "no", "off" (case-insensitive) are false; unset → fallback. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

export const DEFAULT_CONFIG: AcpConfig = {
  host: process.env.ACP_HOST ?? '127.0.0.1',
  port: Number(process.env.ACP_PORT ?? 8787),
  modules: [...ALL_MODULES],
  faucetGrant: Number(process.env.ACP_FAUCET ?? 100_000), // 1,000.00 aUSD
  guardrails: {
    spendCapPerWindow: Number(process.env.ACP_SPEND_CAP ?? 500_000), // 5,000.00 aUSD
    rateLimitPerWindow: Number(process.env.ACP_RATE_LIMIT ?? 120),
    windowMs: Number(process.env.ACP_WINDOW_MS ?? 60_000),
  },
  auth: {
    enforce: envBool('ACP_AUTH_ENFORCE', true),
    freshnessMs: Number(process.env.ACP_AUTH_FRESHNESS_MS ?? 120_000), // 2 minutes
    clockSkewMs: Number(process.env.ACP_AUTH_CLOCK_SKEW_MS ?? 5_000),
    httpRateLimitPerWindow: Number(process.env.ACP_HTTP_RATE_LIMIT ?? 600),
    httpRateWindowMs: Number(process.env.ACP_HTTP_RATE_WINDOW_MS ?? 60_000),
  },
  settlement: {
    mode: (process.env.ACP_SETTLEMENT as SettlementMode) || 'internal',
    rpcUrl: process.env.ACP_SETTLEMENT_RPC_URL,
    tokenAddress: process.env.ACP_SETTLEMENT_TOKEN,
    network: process.env.ACP_SETTLEMENT_NETWORK ?? 'acp-ledger',
    decimals: Number(process.env.ACP_SETTLEMENT_DECIMALS ?? 2),
    explorerBaseUrl: process.env.ACP_SETTLEMENT_EXPLORER,
  },
  consensus: {
    mode: (process.env.ACP_CONSENSUS as ConsensusMode) || 'off',
    authorities: csv(process.env.ACP_AUTHORITIES),
    peers: csv(process.env.ACP_PEERS),
    blockMs: Number(process.env.ACP_BLOCK_MS ?? 3_000),
  },
  mongodbUri: process.env.ACP_MONGODB_URI,
  mongodbDb: process.env.ACP_MONGODB_DB ?? 'acp',
};

/** Parse a comma-separated env var into a trimmed, non-empty list. */
function csv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
