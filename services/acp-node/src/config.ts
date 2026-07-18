/** All ACP modules that ship with the node. Disable any by removing it from `config.modules`. */
export const ALL_MODULES = [
  'naming',
  'registry',
  'messaging',
  'payments',
  'guardrails',
  'observability',
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

export interface AcpConfig {
  host: string;
  port: number;
  /** Which modules the kernel loads, in order. ACP is module-first: add/remove freely. */
  modules: ModuleName[];
  /** Opening balance minted to every new account (a testnet faucet). */
  faucetGrant: number;
  guardrails: GuardrailConfig;
  auth: AuthConfig;
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
  mongodbUri: process.env.ACP_MONGODB_URI,
  mongodbDb: process.env.ACP_MONGODB_DB ?? 'acp',
};
