import type { Ledger } from '@acp/ledger';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { AcpConfig } from './config.js';
import type { EventBus } from './services/bus.js';
import type { ConnectionHub } from './services/connections.js';
import type { Guardrails } from './services/guardrails.js';
import type { Registry } from './services/registry.js';
import type { ReplayGuard } from './services/replay.js';
import type { SettlementProvider } from './services/settlement.js';
import type { Store } from './store/index.js';

/**
 * The surface every module is handed at load time. A module registers routes/handlers on `http`
 * and uses the shared services — but never reaches into another module's internals. This is what
 * makes ACP module-first: features compose through this context and can be added or removed by
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
  connections: ConnectionHub;
  store: Store;
  config: AcpConfig;
  clock: () => string;
  log: FastifyBaseLogger;
}

/** A pluggable ACP capability. */
export interface AcpModule {
  name: string;
  version: string;
  register(ctx: ModuleContext): void | Promise<void>;
}
