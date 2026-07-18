import { AGENT_CARD_VERSION, web3Id as makeWeb3Id } from '@acp/core';
import type { AgentCard, Web3Id } from '@acp/core';
import { deriveDid, generateKemKeypair, generateKeypair, toB64u } from '@acp/crypto';
import type { ModuleContext } from '../context.js';
import { type LlmConfig, llmChat } from './llm.js';

/** Config to launch an agent inside the node, straight from the Genesis wizard. */
export interface HostedAgentConfig {
  handle: string;
  name: string;
  description: string;
  skillId: string;
  skillName: string;
  skillDesc: string;
  price: number; // minor units
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  system?: string;
}

export interface HostedAgentStatus {
  handle: string;
  web3Id: string;
  name: string;
  skill: string;
  price: number;
  provider: string;
  model: string;
  hasKey: boolean;
  running: boolean;
}

type ChatFn = (config: LlmConfig, prompt: string) => Promise<string>;
const SETTING_KEY = 'hosted-agents';

/**
 * Runs Genesis-created agents *inside* the node: registers the agent card + wallet, then binds a
 * virtual relay connection whose task handler calls the configured LLM and replies. Configs persist
 * in the Store (so agents survive restarts and re-launch), and API keys stay server-side.
 *
 * This is the GUI counterpart to the downloadable Python script: one click hosts the agent with no
 * separate process — the node itself is the "no-VPS" host.
 */
export class HostedAgentService {
  private readonly agents = new Map<Web3Id, { config: HostedAgentConfig; running: boolean }>();

  constructor(
    private readonly ctx: ModuleContext,
    private readonly chat: ChatFn = llmChat,
  ) {}

  async load(): Promise<void> {
    const saved = (await this.ctx.store.loadSetting<HostedAgentConfig[]>(SETTING_KEY)) ?? [];
    for (const config of saved) {
      try {
        // These configs are known to be ours, so adopt them without the ownership check that a
        // fresh launch applies (after a restart the card is already in the registry from the store).
        const id = makeWeb3Id(config.handle);
        this.ensureRegistered(id, config);
        this.agents.set(id, { config, running: true });
        this.bindHandler(id, config);
      } catch (err) {
        this.ctx.log.warn({ err }, `hosted: could not relaunch ${config.handle}`);
      }
    }
  }

  status(): HostedAgentStatus[] {
    return [...this.agents.values()].map(({ config, running }) => ({
      handle: config.handle,
      web3Id: makeWeb3Id(config.handle),
      name: config.name,
      skill: config.skillId,
      price: config.price,
      provider: config.provider,
      model: config.model,
      hasKey: Boolean(config.apiKey),
      running,
    }));
  }

  async launch(config: HostedAgentConfig, persist = true): Promise<HostedAgentStatus> {
    const id = makeWeb3Id(config.handle); // throws on a bad handle → caller maps to 400
    if (this.ctx.registry.has(id) && !this.agents.has(id)) {
      throw new Error(`${id} is already taken by another agent`);
    }
    this.ensureRegistered(id, config);
    this.agents.set(id, { config, running: true });
    this.bindHandler(id, config);
    if (persist) await this.persist();
    return this.status().find((s) => s.web3Id === id)!;
  }

  /** Register the agent card + wallet if it isn't already on the node (idempotent). */
  private ensureRegistered(id: Web3Id, config: HostedAgentConfig): void {
    if (this.ctx.registry.has(id)) return;
    const keys = generateKeypair();
    const kem = generateKemKeypair();
    const did = deriveDid(keys.publicKey);
    const card: AgentCard = {
      web3Id: id,
      did,
      name: config.name,
      description: config.description,
      kind: 'agent',
      skills: [
        {
          id: config.skillId,
          name: config.skillName,
          description: config.skillDesc,
          tags: ['llm'],
        },
      ],
      pricing: { perTask: config.price, currency: 'aUSD' },
      signPublicKey: toB64u(keys.publicKey),
      kemPublicKey: toB64u(kem.publicKey),
      version: AGENT_CARD_VERSION,
      createdAt: this.ctx.clock(),
    };
    this.ctx.registry.add(card);
    void this.ctx.store.saveAgent(card);
    this.ctx.ledger.register(id, did, this.ctx.config.faucetGrant);
  }

  async stop(handle: string): Promise<void> {
    const id = makeWeb3Id(handle);
    this.ctx.connections.unbind(id);
    const entry = this.agents.get(id);
    if (entry) entry.running = false;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.ctx.store.saveSetting(
      SETTING_KEY,
      [...this.agents.values()].filter((a) => a.running).map((a) => a.config),
    );
  }

  /** Bind a virtual relay connection that answers task.submit with the LLM and replies. */
  private bindHandler(id: Web3Id, config: HostedAgentConfig): void {
    const conn = {
      readyState: 1,
      OPEN: 1,
      send: (raw: string) => {
        let frame: { kind?: string; message?: HostedTaskMessage };
        try {
          frame = JSON.parse(raw);
        } catch {
          return;
        }
        const m = frame.message;
        if (frame.kind !== 'deliver' || m?.body?.type !== 'task.submit') return;
        void this.handleTask(id, config, m);
      },
    };
    this.ctx.connections.bind(id, conn as never);
  }

  private async handleTask(
    id: Web3Id,
    config: HostedAgentConfig,
    m: HostedTaskMessage,
  ): Promise<void> {
    const question = m.body.input?.question ?? '';
    let output: Record<string, unknown>;
    let state = 'completed';
    try {
      const answer = await this.chat(
        {
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          system: config.system,
        },
        question,
      );
      output = { answer };
    } catch (err) {
      output = { error: err instanceof Error ? err.message : String(err) };
      state = 'failed';
    }
    this.ctx.connections.sendTo(m.from as Web3Id, {
      kind: 'deliver',
      message: {
        id: `r_${m.body.taskId}`,
        from: id,
        to: m.from,
        ts: this.ctx.clock(),
        body: { type: 'task.result', taskId: m.body.taskId, state, output },
      },
    });
  }
}

interface HostedTaskMessage {
  from: string;
  body: { type: string; taskId: string; input?: { question?: string } };
}
