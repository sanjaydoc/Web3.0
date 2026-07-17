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

export interface AcpConfig {
  host: string;
  port: number;
  /** Which modules the kernel loads, in order. ACP is module-first: add/remove freely. */
  modules: ModuleName[];
  /** Opening balance minted to every new account (a testnet faucet). */
  faucetGrant: number;
  guardrails: GuardrailConfig;
  /** MongoDB connection string. When set, state persists across restarts; else in-memory. */
  mongodbUri?: string;
  /** Database name to use within the MongoDB cluster. */
  mongodbDb: string;
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
  mongodbUri: process.env.ACP_MONGODB_URI,
  mongodbDb: process.env.ACP_MONGODB_DB ?? 'acp',
};
