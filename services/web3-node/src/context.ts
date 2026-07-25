import type { Ledger } from '@web3/ledger';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Web3Config } from './config.js';
import type { AccountsService } from './services/accounts.js';
import type { EventBus } from './services/bus.js';
import type { ConnectionHub } from './services/connections.js';
import type { ConnectorsService } from './services/connectors.js';
import type { ConsensusCoordinator } from './services/consensus.js';
import type { EconomicsService } from './services/economics.js';
import type { Guardrails } from './services/guardrails.js';
import type { Mempool } from './services/mempool.js';
import type { NetworkAccounts } from './services/network-accounts.js';
import type { Registry } from './services/registry.js';
import type { ReplayGuard } from './services/replay.js';
import type { SettlementProvider } from './services/settlement.js';
import type { SkillsService } from './services/skills.js';
import type { Store } from './store/index.js';

/**
 * The surface every module is handed at load time. A module registers routes/handlers on `http`
 * and uses the shared services — but never reaches into another module's internals. This is what
 * makes Web3.0 module-first: features compose through this context and can be added or removed by
 * editing `config.modules`.
 */
export interface ModuleContext {
  http: FastifyInstance;
  ledger: Ledger;
  registry: Registry;
  bus: EventBus;
  guardrails: Guardrails;
  replay: ReplayGuard;
  settlement: SettlementProvider;
  consensus: ConsensusCoordinator;
  /** Chain-fed index of account keys + nonces (identical on every node). */
  networkAccounts: NetworkAccounts;
  /** Validating mempool for account-signed transactions (trustless writes). */
  mempool: Mempool;
  connections: ConnectionHub;
  store: Store;
  /** Sign-up + authentication: resolves accounts, addresses, and roles from Web3.0 tokens. */
  accounts: AccountsService;
  /** Skill catalogue: named capabilities node operators register for agents to advertise. */
  skills: SkillsService;
  /** Custom connector registry (on top of the dashboard's built-in catalogue). */
  connectors: ConnectorsService;
  /** Live monetary policy (fees, rewards, burn, stake) — GUI-editable, persisted. */
  economics: EconomicsService;
  config: Web3Config;
  /** The node treasury's Web3.0 ID — where protocol fees and block rewards accrue. */
  treasuryId: string;
  /** This node's ML-DSA signing public key (base64url) — its identity in the authority set. */
  nodePublicKey: string;
  /** Epoch-ms the node process started (for uptime). */
  startedAt: number;
  clock: () => string;
  log: FastifyBaseLogger;
}

/** A pluggable Web3.0 capability. */
export interface Web3Module {
  name: string;
  version: string;
  register(ctx: ModuleContext): void | Promise<void>;
}
