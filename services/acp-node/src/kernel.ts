import { generateKeypair, toB64u } from '@acp/crypto';
import type { Keypair } from '@acp/crypto';
import { Ledger } from '@acp/ledger';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type AcpConfig, DEFAULT_CONFIG } from './config.js';
import type { AcpModule, ModuleContext } from './context.js';
import { MODULE_FACTORIES } from './modules/index.js';
import { EventBus } from './services/bus.js';
import { ConnectionHub } from './services/connections.js';
import { Guardrails } from './services/guardrails.js';
import { Registry } from './services/registry.js';

/**
 * The ACP kernel — a thin core that owns the shared services (ledger, registry, event bus,
 * guardrails, connections) and loads the modules named in config. This is the "agentic OS":
 * capabilities are modules bolted onto a small, stable core.
 */
export class Kernel {
  readonly config: AcpConfig;
  readonly http: FastifyInstance;
  readonly ledger: Ledger;
  readonly registry: Registry;
  readonly bus: EventBus;
  readonly guardrails: Guardrails;
  readonly connections: ConnectionHub;
  readonly nodeKeys: Keypair;
  readonly loaded: string[] = [];

  constructor(config: Partial<AcpConfig> = {}, nodeKeys: Keypair = generateKeypair()) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const clock = () => new Date().toISOString();
    this.nodeKeys = nodeKeys;
    this.ledger = new Ledger(nodeKeys, toB64u(nodeKeys.publicKey), clock);
    this.registry = new Registry();
    this.bus = new EventBus(clock);
    this.guardrails = new Guardrails(this.config.guardrails, () => Date.now());
    this.connections = new ConnectionHub();
    const level = process.env.ACP_LOG_LEVEL ?? 'info';
    this.http = Fastify({ logger: level === 'silent' ? false : { level } });
  }

  /** Register base plugins and every configured module. Call once before `listen`. */
  async init(): Promise<this> {
    await this.http.register(cors, { origin: true });
    await this.http.register(websocket);

    this.http.get('/', () => ({
      name: 'ACP node',
      description: 'The agentic internet — quantum-resistant agent communication protocol.',
      version: '0.1.0',
      modules: this.loaded,
      nodePublicKey: toB64u(this.nodeKeys.publicKey),
    }));
    this.http.get('/health', () => ({ ok: true, ledgerVerified: this.ledger.verifyChain().ok }));

    const ctx: ModuleContext = {
      http: this.http,
      ledger: this.ledger,
      registry: this.registry,
      bus: this.bus,
      guardrails: this.guardrails,
      connections: this.connections,
      config: this.config,
      clock: () => new Date().toISOString(),
      log: this.http.log,
    };

    for (const name of this.config.modules) {
      const factory = MODULE_FACTORIES[name];
      if (!factory) {
        this.http.log.warn(`unknown module "${name}" — skipping`);
        continue;
      }
      const mod: AcpModule = factory();
      await mod.register(ctx);
      this.loaded.push(mod.name);
      this.http.log.info(`loaded module ${mod.name}@${mod.version}`);
    }
    return this;
  }

  async listen(): Promise<string> {
    const address = await this.http.listen({ host: this.config.host, port: this.config.port });
    this.http.log.info(`ACP node listening on ${address} · modules: ${this.loaded.join(', ')}`);
    return address;
  }

  async close(): Promise<void> {
    await this.http.close();
  }
}
