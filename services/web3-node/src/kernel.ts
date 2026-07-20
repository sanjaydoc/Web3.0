import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { AGENT_CARD_VERSION, web3Id as makeWeb3Id } from '@web3/core';
import type { AgentCard } from '@web3/core';
import { deriveDid, generateKemKeypair, generateKeypair, toB64u } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import { Ledger } from '@web3/ledger';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_CONFIG, type Web3Config } from './config.js';
import type { ModuleContext, Web3Module } from './context.js';
import { MODULE_FACTORIES } from './modules/index.js';
import { AccountsService } from './services/accounts.js';
import { EventBus } from './services/bus.js';
import { ConnectionHub } from './services/connections.js';
import { ConnectorsService } from './services/connectors.js';
import { ConsensusCoordinator } from './services/consensus.js';
import { Guardrails } from './services/guardrails.js';
import { RateLimiter } from './services/ratelimit.js';
import { Registry } from './services/registry.js';
import { ReplayGuard } from './services/replay.js';
import { type SettlementProvider, createSettlement } from './services/settlement.js';
import { SkillsService } from './services/skills.js';
import { type Store, createStore } from './store/index.js';

/**
 * The Web3.0 kernel — a thin core that owns the shared services (ledger, registry, event bus,
 * guardrails, connections) and loads the modules named in config. This is the "agentic OS":
 * capabilities are modules bolted onto a small, stable core.
 */
export class Kernel {
  readonly config: Web3Config;
  readonly http: FastifyInstance;
  readonly ledger: Ledger;
  readonly registry: Registry;
  readonly bus: EventBus;
  readonly guardrails: Guardrails;
  readonly replay: ReplayGuard;
  readonly settlement: SettlementProvider;
  readonly consensus: ConsensusCoordinator;
  readonly httpLimiter: RateLimiter;
  readonly connections: ConnectionHub;
  readonly nodeKeys: Keypair;
  readonly treasuryId: string;
  readonly store: Store;
  readonly startedAt = Date.now();
  readonly loaded: string[] = [];
  /** In-flight write-behind persistence, drained on close(). */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    config: Partial<Web3Config> = {},
    nodeKeys: Keypair = generateKeypair(),
    store?: Store,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const clock = () => new Date().toISOString();
    this.nodeKeys = nodeKeys;
    this.ledger = new Ledger(nodeKeys, toB64u(nodeKeys.publicKey), clock);
    this.registry = new Registry();
    this.bus = new EventBus(clock);
    this.guardrails = new Guardrails(this.config.guardrails, () => Date.now());
    this.replay = new ReplayGuard(this.config.auth, () => Date.now());
    this.settlement = createSettlement(this.config.settlement);
    this.treasuryId = makeWeb3Id(this.config.fees.treasuryLocal);
    this.consensus = new ConsensusCoordinator(this.config.consensus, this.nodeKeys, this.ledger, {
      treasuryId: this.treasuryId,
      blockReward: this.config.fees.blockReward,
      authorityStake: this.config.authorityStake,
    });
    this.httpLimiter = new RateLimiter(
      this.config.auth.httpRateLimitPerWindow,
      this.config.auth.httpRateWindowMs,
      () => Date.now(),
    );
    this.connections = new ConnectionHub();
    this.store = store ?? createStore(this.config);
    const level = process.env.WEB3_LOG_LEVEL ?? 'info';
    this.http = Fastify({ logger: level === 'silent' ? false : { level } });
  }

  /** Register base plugins and every configured module. Call once before `listen`. */
  async init(): Promise<this> {
    // Restore persisted state, then wire write-through so future mutations are durable.
    await this.store.init();
    this.http.log.info(
      this.store.kind === 'mongodb'
        ? 'persistence: MongoDB connected (state survives restarts)'
        : 'persistence: in-memory (state is lost on restart — set WEB3_MONGODB_URI to persist)',
    );
    this.http.log.info(`settlement: ${this.settlement.describe()}`);
    for (const card of await this.store.loadAgents()) this.registry.add(card);
    this.ledger.hydrate(await this.store.loadLedger());
    this.ledger.onAppend = (entry) => {
      const p = this.store
        .appendEntry(entry)
        .catch((err) => this.http.log.error({ err }, 'ledger persistence failed'));
      this.inflight.add(p);
      void p.finally(() => this.inflight.delete(p));
    };
    // The node treasury collects protocol fees + block rewards. Register it once (idempotent) so
    // earnings are visible in the registry and wallets.
    this.ensureTreasury();
    if (this.registry.size > 0 || this.ledger.size > 0) {
      this.http.log.info(
        `restored ${this.registry.size} agents and ${this.ledger.size} ledger entries from ${this.store.kind} store`,
      );
    }

    await this.http.register(cors, { origin: true });
    await this.http.register(websocket);

    // HTTP rate limit (per client IP) — a coarse DoS backstop in front of the per-agent guardrails.
    // Runs before route handlers; /health is exempt so monitoring is never throttled.
    this.http.addHook('onRequest', (request, reply, done) => {
      if (request.url === '/health') return done();
      const verdict = this.httpLimiter.check(request.ip);
      if (!verdict.ok) {
        this.bus.emit({
          kind: 'auth.rejected',
          summary: `DENY http · rate-limit: ${verdict.count}/${verdict.limit} from ${request.ip}`,
          data: {
            policy: 'http-rate-limit',
            decision: 'DENY',
            ip: request.ip,
            count: verdict.count,
            limit: verdict.limit,
            enforced: this.config.auth.enforce,
          },
        });
        if (this.config.auth.enforce) {
          reply.code(429).send({ error: 'rate limit exceeded — slow down' });
          return;
        }
      }
      done();
    });

    this.http.get('/', () => ({
      name: 'Web3.0 node',
      description: 'The agentic internet — quantum-resistant agent communication protocol.',
      version: '0.1.0',
      modules: this.loaded,
      nodePublicKey: toB64u(this.nodeKeys.publicKey),
    }));
    this.http.get('/health', () => ({ ok: true, ledgerVerified: this.ledger.verifyChain().ok }));

    const clock = () => new Date().toISOString();
    const accounts = new AccountsService(this.store, clock);
    await accounts.load();
    const skills = new SkillsService(this.store, clock);
    await skills.load();
    const connectors = new ConnectorsService(this.store, clock);
    await connectors.load();

    const ctx: ModuleContext = {
      http: this.http,
      ledger: this.ledger,
      registry: this.registry,
      bus: this.bus,
      guardrails: this.guardrails,
      replay: this.replay,
      settlement: this.settlement,
      consensus: this.consensus,
      connections: this.connections,
      store: this.store,
      accounts,
      skills,
      connectors,
      config: this.config,
      treasuryId: this.treasuryId,
      nodePublicKey: toB64u(this.nodeKeys.publicKey),
      startedAt: this.startedAt,
      clock,
      log: this.http.log,
    };

    for (const name of this.config.modules) {
      const factory = MODULE_FACTORIES[name];
      if (!factory) {
        this.http.log.warn(`unknown module "${name}" — skipping`);
        continue;
      }
      const mod: Web3Module = factory();
      await mod.register(ctx);
      this.loaded.push(mod.name);
      this.http.log.info(`loaded module ${mod.name}@${mod.version}`);
    }
    return this;
  }

  async listen(): Promise<string> {
    const address = await this.http.listen({ host: this.config.host, port: this.config.port });
    this.http.log.info(`Web3.0 node listening on ${address} · modules: ${this.loaded.join(', ')}`);
    return address;
  }

  /** Register the treasury account (card + wallet) if it isn't already on the node. */
  private ensureTreasury(): void {
    const id = makeWeb3Id(this.config.fees.treasuryLocal);
    if (this.registry.has(id)) return;
    const keys = generateKeypair();
    const kem = generateKemKeypair();
    const did = deriveDid(keys.publicKey);
    const card: AgentCard = {
      web3Id: id,
      did,
      name: 'Node treasury',
      description: 'Collects protocol fees and block rewards for the node operator.',
      kind: 'agent',
      skills: [],
      signPublicKey: toB64u(keys.publicKey),
      kemPublicKey: toB64u(kem.publicKey),
      version: AGENT_CARD_VERSION,
      createdAt: new Date().toISOString(),
    };
    this.registry.add(card);
    void this.store.saveAgent(card);
    this.ledger.register(id, did, 0); // opens a zero-balance wallet
  }

  async close(): Promise<void> {
    await this.http.close();
    // Drain write-behind persistence before releasing the store.
    await Promise.allSettled([...this.inflight]);
    await this.store.close();
  }
}
