import type { Ledger } from '@web3/ledger';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Web3Config } from './config.js';
import type { AccountsService } from './services/accounts.js';
import type { EventBus } from './services/bus.js';
import type { ConnectionHub } from './services/connections.js';
import type { ConsensusCoordinator } from './services/consensus.js';
import type { Guardrails } from './services/guardrails.js';
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
  connections: ConnectionHub;
  store: Store;
  /** Sign-up + authentication: resolves accounts, addresses, and roles from Web3.0 tokens. */
  accounts: AccountsService;
  /** Skill catalogue: named capabilities node operators register for agents to advertise. */
  skills: SkillsService;
  config: Web3Config;
  /** The node treasury's Web3.0 ID — where protocol fees and block rewards accrue. */
  treasuryId: string;
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
