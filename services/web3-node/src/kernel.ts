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
import { ContributionService } from './services/contribution.js';
import { EconomicsService } from './services/economics.js';
import { Guardrails } from './services/guardrails.js';
import { Mempool } from './services/mempool.js';
import { NetworkAccounts } from './services/network-accounts.js';
import { RateLimiter } from './services/ratelimit.js';
import { Registry } from './services/registry.js';
import { ReplayGuard } from './services/replay.js';
import { type SettlementProvider, createSettlement } from './services/settlement.js';
import { SkillsService } from './services/skills.js';
import { type Store, createStore, recordStoreMode } from './store/index.js';

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
  /** Chain-fed index of account keys + nonces — identical on every node. */
  readonly networkAccounts: NetworkAccounts;
  /** Validating mempool for account-signed transactions (trustless writes). */
  readonly mempool: Mempool;
  readonly economics: EconomicsService;
  /** Proof-of-Contribution registry: peer heartbeats feeding epoch reward distribution. */
  readonly contribution: ContributionService;
  readonly httpLimiter: RateLimiter;
  readonly connections: ConnectionHub;
  readonly nodeKeys: Keypair;
  readonly treasuryId: string;
  readonly store: Store;
  readonly startedAt = Date.now();
  readonly loaded: string[] = [];

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
    this.store = store ?? createStore(this.config);
    // Live monetary policy: seeded from env config, then GUI-owned (persisted in the store).
    this.economics = new EconomicsService(this.store, {
      feeBps: this.config.fees.protocolBps,
      blockReward: this.config.fees.blockReward,
      burnBps: this.config.fees.burnBps,
      authorityStake: this.config.authorityStake,
      nodeRewardPool: this.config.fees.nodeRewardPool,
      epochBlocks: this.config.fees.epochBlocks,
      uptimeWeight: this.config.fees.uptimeWeight,
      hostWeight: this.config.fees.hostWeight,
      relayWeight: this.config.fees.relayWeight,
      rewardCapBps: this.config.fees.rewardCapBps,
    });
    this.networkAccounts = new NetworkAccounts();
    this.mempool = new Mempool(this.ledger, this.networkAccounts);
    // Freshness window for contribution heartbeats reuses the auth envelope freshness.
    this.contribution = new ContributionService(() => Date.now(), this.config.auth.freshnessMs);
    this.consensus = new ConsensusCoordinator(
      this.config.consensus,
      this.nodeKeys,
      this.ledger,
      {
        treasuryId: this.treasuryId,
        blockReward: () => this.economics.blockReward,
        authorityStake: () => this.economics.authorityStake,
        nodeRewardPool: () => this.economics.nodeRewardPool,
        epochBlocks: () => this.economics.epochBlocks,
        weights: () => ({
          uptime: this.economics.uptimeWeight,
          host: this.economics.hostWeight,
          relay: this.economics.relayWeight,
        }),
        rewardCapBps: () => this.economics.rewardCapBps,
      },
      { mempool: this.mempool, accounts: this.networkAccounts, contribution: this.contribution },
    );
    this.httpLimiter = new RateLimiter(
      this.config.auth.httpRateLimitPerWindow,
      this.config.auth.httpRateWindowMs,
      () => Date.now(),
    );
    this.connections = new ConnectionHub();
    const level = process.env.WEB3_LOG_LEVEL ?? 'info';
    this.http = Fastify({ logger: level === 'silent' ? false : { level } });
  }

  /** Register base plugins and every configured module. Call once before `listen`. */
  async init(): Promise<this> {
    // Restore persisted state, then wire write-through so future mutations are durable.
    await this.store.init();
    // Remember the backend that just connected, so a future boot that loses its database URL fails
    // loud (see createStore's downgrade guard) instead of silently coming up empty on memory.
    if (this.store.kind !== 'memory') recordStoreMode(this.store.kind);
    const PERSISTENCE_MSG: Record<typeof this.store.kind, string> = {
      postgres: 'persistence: PostgreSQL connected (state survives restarts)',
      mongodb: 'persistence: MongoDB connected (state survives restarts)',
      file: 'persistence: file-backed store on disk (state survives restarts)',
      memory:
        'persistence: in-memory (state is lost on restart — set WEB3_POSTGRES_URL, WEB3_MONGODB_URI, or WEB3_STORE_PATH to persist)',
    };
    this.http.log.info(PERSISTENCE_MSG[this.store.kind]);
    this.http.log.info(`settlement: ${this.settlement.describe()}`);
    for (const card of await this.store.loadAgents()) this.registry.add(card);
    this.ledger.hydrate(await this.store.loadLedger());
    // Rebuild the account key/nonce index from persisted history, so key bindings and replay
    // protection survive a restart before any new entry is appended.
    for (const entry of this.ledger.all()) this.networkAccounts.observe(entry);
    // Synchronous, in-memory side effect: keep the network-account index current with every local
    // write (key bindings + tx nonces) so the mempool sees them immediately.
    this.ledger.onAppend = (entry) => this.networkAccounts.observe(entry);
    // Durable persistence runs through the ledger's serialized, retrying write queue — ordered,
    // awaited, and retried on a transient store failure — so a dropped write can never leave a
    // seq-gap that breaks the hash chain on restart. Await `ledger.flush()` at commit boundaries.
    this.ledger.onPersist = (entry) => this.store.appendEntry(entry);
    this.ledger.onPersistError = (entry, err) =>
      this.http.log.error(
        { err, seq: entry.seq },
        'ledger persistence permanently failed after retries — store may be unavailable',
      );
    // The node treasury collects protocol fees + block rewards. Register it once (idempotent) so
    // earnings are visible in the registry and wallets.
    this.ensureTreasury();
    if (this.registry.size > 0 || this.ledger.size > 0) {
      this.http.log.info(
        `restored ${this.registry.size} agents and ${this.ledger.size} ledger entries from ${this.store.kind} store`,
      );
    }

    // CORS: with no configured origins, reflect any origin (dev). In production, WEB3_CORS_ORIGIN
    // pins the dashboard origin(s) so only your console (e.g. the GitHub Pages site) may call the API.
    const allowed = this.config.corsOrigins ?? [];
    await this.http.register(cors, { origin: allowed.length > 0 ? allowed : true });
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
    this.http.get('/health', () => ({
      ok: true,
      ledgerVerified: this.ledger.verifyChainCached().ok,
    }));

    const clock = () => new Date().toISOString();
    const accounts = new AccountsService(this.store, clock);
    await accounts.load();
    // Make the auth state visible at boot — the difference between "N accounts loaded" and "open
    // mode" is otherwise invisible and turns a store/load hiccup into a baffling "operator works but
    // login doesn't". If no accounts loaded and no admin token is set, the node is OPEN: privileged
    // endpoints answer any caller. Loud on purpose.
    const openMode = !accounts.hasAccounts() && !process.env.WEB3_ADMIN_TOKEN;
    if (openMode) {
      this.http.log.warn(
        'auth: OPEN MODE — no accounts loaded and no WEB3_ADMIN_TOKEN; privileged endpoints accept any caller',
      );
    } else {
      this.http.log.info(
        `auth: ${accounts.list().length} account(s) loaded (admin present: ${accounts.hasAdmin() ? 'yes' : 'no'})`,
      );
    }
    const skills = new SkillsService(this.store, clock);
    await skills.load();
    const connectors = new ConnectorsService(this.store, clock);
    await connectors.load();
    await this.economics.load();

    const ctx: ModuleContext = {
      http: this.http,
      ledger: this.ledger,
      registry: this.registry,
      bus: this.bus,
      guardrails: this.guardrails,
      replay: this.replay,
      settlement: this.settlement,
      consensus: this.consensus,
      networkAccounts: this.networkAccounts,
      mempool: this.mempool,
      connections: this.connections,
      store: this.store,
      accounts,
      skills,
      connectors,
      economics: this.economics,
      contribution: this.contribution,
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
    // Drain the durable-write queue before releasing the store, so nothing appended in memory is
    // left unpersisted (which would restart as a seq-gap).
    await this.ledger
      .flush()
      .catch((err) => this.http.log.error({ err }, 'ledger flush on close failed'));
    await this.store.close();
  }
}
