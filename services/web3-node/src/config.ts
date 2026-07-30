/** All Web3.0 modules that ship with the node. Disable any by removing it from `config.modules`. */
export const ALL_MODULES = [
  'naming',
  'accounts',
  'skills',
  'connectors',
  'registry',
  'messaging',
  'payments',
  'x402',
  'guardrails',
  'observability',
  'consensus',
  'tx',
  'telegram',
  'hosted',
  'operator',
  'hosting',
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

/**
 * x402 — the internet-native "HTTP 402 Payment Required" standard, so external agents (and the
 * official `x402-fetch` client / OpenX402 facilitators) can pay the node's resources in USDC, and
 * the node can itself act as a permissionless facilitator. `settle` picks how facilitated payments
 * finalise: `ledger` mirrors them onto the local PQC ledger (default, fully offline); `upstream`
 * forwards verify/settle to a real facilitator (OpenX402 / CDP) for live on-chain settlement.
 */
export interface X402Config {
  /** Mount the node's x402 facilitator endpoints + the priced demo resource. */
  enabled: boolean;
  /** Network label advertised in 402 responses and `/x402/supported` (e.g. `base-sepolia`). */
  network: string;
  /** ERC-20 asset (USDC) advertised for payment. */
  asset: string;
  /** EVM address that receives payment for the node's own priced resources. */
  payTo: string;
  /** EIP-712 domain for the asset. USDC uses name `USDC`, version `2`. */
  domainName: string;
  domainVersion: string;
  /** Price of the built-in demo resource in the asset's atomic units (USDC 6dp). 50000 = $0.05. */
  demoPriceAtomic: string;
  /** Settlement backend: `ledger` (mirror on the PQC ledger) or `upstream` (remote facilitator). */
  settle: 'ledger' | 'upstream';
  /** Upstream facilitator base URL when `settle=upstream` (e.g. https://facilitator.openx402.ai). */
  facilitatorUrl?: string;
  /** Optional block-explorer base (…/tx/) used to build receipt links on real chains. */
  explorerBaseUrl?: string;
}

/** Operator incentives — how running a node earns aETH. All default to 0 (off). */
export interface FeesConfig {
  /** Protocol fee on each payment, in basis points, skimmed from the payee to the node treasury. */
  protocolBps: number;
  /** aETH minted to a block's proposer as a reward (only when this node proposes). */
  blockReward: number;
  /** EIP-1559-style burn on each payment, in basis points (0 = no burn). */
  burnBps: number;
  /** Local part of the node's treasury Web3.0 ID that collects earnings. */
  treasuryLocal: string;
  // ── Proof-of-Contribution: the contribution pool is now FEE-FUNDED (the 1% pool slice of every
  // payment/hosting fee), distributed by score each epoch — non-inflationary. `nodeRewardPool` is only
  // an OPTIONAL, off-by-default mint subsidy on top of that, for bootstrapping before real demand. ──
  /** OPTIONAL extra aETH minted per epoch (0 = off; the pool itself is funded from fees, not minted). */
  nodeRewardPool: number;
  /** Epoch length in blocks — the pool is distributed once every this many blocks. */
  epochBlocks: number;
  /** Contribution-score weight per hour of node uptime. */
  uptimeWeight: number;
  /** Contribution-score weight per hosted agent. */
  hostWeight: number;
  /** Contribution-score weight per served request/tx. */
  relayWeight: number;
  /** Max share of one epoch's pool a single node may take, in basis points (0 = uncapped). */
  rewardCapBps: number;
  /**
   * Platform commission on every hosting fee (aETH earned from selling RAM), in basis points. The
   * host receives the remainder; the commission goes to the treasury. Default 300 = 3%.
   */
  hostingCommissionBps: number;
}

export interface Web3Config {
  host: string;
  port: number;
  /** Which modules the kernel loads, in order. Web3.0 is module-first: add/remove freely. */
  modules: ModuleName[];
  /** Opening balance minted to every new account (a testnet faucet). */
  faucetGrant: number;
  /**
   * RAM budget (MB) assumed per hosted agent. A node's hosting capacity (max agents) is derived from
   * the RAM it contributes: floor(maxRamMb / ramMbPerAgent). This is what makes contributed RAM a real
   * capacity ceiling instead of a cosmetic number. Default 256 MB/agent.
   */
  ramMbPerAgent: number;
  /**
   * Freemium cap (GitHub-for-agents): the max agents a `free`-plan owner may host. `pro` accounts are
   * uncapped. Default 3. Set 0 for an unlimited free tier.
   */
  freeMaxAgents: number;
  /**
   * Admin-only mode. When true, this node is reserved for its admin: non-admins may still sign up
   * and read public data, but compute/hosting actions (launching agents) are refused with a prompt
   * to run their own node. Set on the network's main node so operators contribute from their own
   * devices instead of leaning on it. Default false (a normal permissionless node).
   */
  adminOnly: boolean;
  guardrails: GuardrailConfig;
  auth: AuthConfig;
  settlement: SettlementConfig;
  x402: X402Config;
  consensus: ConsensusConfig;
  fees: FeesConfig;
  /**
   * Permissionless authority admission (Ethereum-style): stake this much aETH (minor units) to the
   * on-chain escrow and the network seats your node key automatically — no admin approval needed.
   * Default 3,200,000 minor = 32,000.00 aETH (32× the faucet grant; a nod to ETH's 32).
   */
  authorityStake: number;
  /** Cooldown (ms) between requesting an unstake and the escrow refund (Ethereum-style exit delay). */
  unstakeCooldownMs: number;
  /**
   * PostgreSQL connection string. When set, state persists in Postgres (takes precedence over
   * MongoDB) — self-host it on the node's own disk for uncapped storage.
   */
  postgresUrl?: string;
  /** MongoDB connection string. When set, state persists across restarts; else in-memory. */
  mongodbUri?: string;
  /** Database name to use within the MongoDB cluster. */
  mongodbDb: string;
  /**
   * Directory for a file-backed store. When set (and no Postgres/Mongo URL is), state persists to
   * JSON files on disk — the durable option for an on-device node (desktop app / phone) that has no
   * database but does have a private, update-surviving data directory. Lower precedence than a real
   * DB, higher than the in-memory default.
   */
  storePath?: string;
  /**
   * Browser origins allowed to call this node (CORS). Undefined/empty ⇒ reflect any origin (dev
   * default). In production set `WEB3_CORS_ORIGIN` to your dashboard's origin(s) — comma-separated,
   * e.g. `https://sanjaydoc.github.io,https://console.web3.example` — to lock it down.
   */
  corsOrigins?: string[];
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

// ── deployment files ─────────────────────────────────────────────────────────────────────────────
// network.json — the network's genesis defaults (consensus mode, authority set, peers), so a
// downloaded node JOINS the network out of the box instead of booting solo. Env vars win over the
// file; the file wins over built-in defaults. The desktop app bundles it and points
// WEB3_NETWORK_FILE at its copy.
// config.json (WEB3_CONFIG_PATH) — GUI-saved node settings (storage today). Same precedence.
import { existsSync, readFileSync } from 'node:fs';

function readJsonFile<T>(path: string | undefined): Partial<T> {
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<T>;
  } catch {
    return {};
  }
}

interface NetworkFile {
  consensus?: Partial<ConsensusConfig>;
}
interface LocalConfigFile {
  postgresUrl?: string;
  mongodbUri?: string;
  mongodbDb?: string;
  storePath?: string;
}

const networkFile =
  readJsonFile<NetworkFile>(process.env.WEB3_NETWORK_FILE ?? 'network.json').consensus ?? {};
export const CONFIG_FILE_PATH = process.env.WEB3_CONFIG_PATH ?? '';
const localFile = readJsonFile<LocalConfigFile>(CONFIG_FILE_PATH || undefined);

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
  ramMbPerAgent: Math.max(1, Number(process.env.WEB3_RAM_MB_PER_AGENT ?? 256)),
  freeMaxAgents: Math.max(0, Number(process.env.WEB3_FREE_MAX_AGENTS ?? 3)),
  adminOnly: envBool('WEB3_ADMIN_ONLY', false),
  corsOrigins: (process.env.WEB3_CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
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
  x402: {
    enabled: envBool('WEB3_X402_ENABLED', true),
    network: process.env.WEB3_X402_NETWORK ?? 'base-sepolia',
    // Base Sepolia testnet USDC by default.
    asset: process.env.WEB3_X402_ASSET ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    // Operators set their real receiving address; the placeholder (…0402) keeps demos self-contained.
    payTo:
      process.env.WEB3_X402_PAYTO ??
      (process.env.WEB3_X402_KEY ? '' : '0x0000000000000000000000000000000000000402'),
    domainName: process.env.WEB3_X402_DOMAIN_NAME ?? 'USDC',
    domainVersion: process.env.WEB3_X402_DOMAIN_VERSION ?? '2',
    demoPriceAtomic: process.env.WEB3_X402_DEMO_PRICE ?? '50000', // $0.05 USDC
    settle: (process.env.WEB3_X402_SETTLE as 'ledger' | 'upstream') || 'ledger',
    facilitatorUrl: process.env.WEB3_X402_FACILITATOR_URL,
    explorerBaseUrl: process.env.WEB3_X402_EXPLORER,
  },
  consensus: {
    mode: (process.env.WEB3_CONSENSUS as ConsensusMode) || networkFile.mode || 'off',
    authorities: process.env.WEB3_AUTHORITIES
      ? csv(process.env.WEB3_AUTHORITIES)
      : (networkFile.authorities ?? []),
    peers: process.env.WEB3_PEERS ? csv(process.env.WEB3_PEERS) : (networkFile.peers ?? []),
    blockMs: Number(process.env.WEB3_BLOCK_MS ?? networkFile.blockMs ?? 3_000),
    slotMs: Number(process.env.WEB3_SLOT_MS ?? networkFile.slotMs ?? 6_000),
  },
  fees: {
    protocolBps: Number(process.env.WEB3_FEE_BPS ?? 300), // 3% take-rate on payments, split 1/1/1
    // Minting OFF by default — the node-reward and contribution-pool rewards are now funded from the
    // 1/1/1 split of real fees (see splitFee), so nothing is printed. These two mint knobs stay as an
    // optional, off-by-default bootstrap subsidy (set >0 to temporarily mint before real demand).
    blockReward: Number(process.env.WEB3_BLOCK_REWARD ?? 0), // per-block mint to proposer (0 = off)
    burnBps: Number(process.env.WEB3_BURN_BPS ?? 0),
    treasuryLocal: process.env.WEB3_TREASURY ?? 'treasury',
    nodeRewardPool: Number(process.env.WEB3_NODE_REWARD_POOL ?? 0), // legacy per-epoch mint (0 = off; pool is fee-funded)
    epochBlocks: Math.max(1, Number(process.env.WEB3_EPOCH_BLOCKS ?? 20)),
    uptimeWeight: Number(process.env.WEB3_UPTIME_WEIGHT ?? 1),
    hostWeight: Number(process.env.WEB3_HOST_WEIGHT ?? 2),
    relayWeight: Number(process.env.WEB3_RELAY_WEIGHT ?? 1),
    rewardCapBps: Number(process.env.WEB3_REWARD_CAP_BPS ?? 2_000), // 20% per node by default
    hostingCommissionBps: Number(process.env.WEB3_HOSTING_COMMISSION_BPS ?? 300), // 3% platform cut
  },
  authorityStake: Number(process.env.WEB3_AUTHORITY_STAKE ?? 3_200_000), // 32,000.00 aETH
  unstakeCooldownMs: Number(process.env.WEB3_UNSTAKE_COOLDOWN_MS ?? 86_400_000), // 24 h

  postgresUrl: process.env.WEB3_POSTGRES_URL ?? localFile.postgresUrl,
  mongodbUri: process.env.WEB3_MONGODB_URI ?? localFile.mongodbUri,
  mongodbDb: process.env.WEB3_MONGODB_DB ?? localFile.mongodbDb ?? 'web3',
  storePath: process.env.WEB3_STORE_PATH ?? localFile.storePath,
};

/** Parse a comma-separated env var into a trimmed, non-empty list. */
function csv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
