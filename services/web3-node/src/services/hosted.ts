import { AGENT_CARD_VERSION, web3Id as makeWeb3Id } from '@web3/core';
import type { AgentCard, Web3Id } from '@web3/core';
import { deriveDid, generateKemKeypair, generateKeypair, toB64u } from '@web3/crypto';
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
  /** If set, this is a *dApp*: instead of an LLM, tasks are POSTed to this HTTP endpoint and its
   * JSON response ({ answer } or any object) is returned. Lets developers publish any web service
   * as an agent on Web3.0. */
  webhookUrl?: string;
  /** Who published this (a free-text publisher/creator label — there is no user auth). */
  createdBy?: string;
  /** Names of the connectors this agent is allowed to use (from the Connectors catalogue). */
  connectors?: string[];
  /** ISO timestamp set by the node when the agent is first launched. */
  createdAt?: string;
}

export interface HostedAgentStatus {
  handle: string;
  web3Id: string;
  name: string;
  description: string;
  skill: string;
  price: number;
  provider: string;
  model: string;
  /** 'llm' = brain is a model; 'webhook' = a dApp backed by an external endpoint. */
  kind: 'llm' | 'webhook';
  hasKey: boolean;
  running: boolean;
  /** Publisher/creator label, or 'unknown' if none was given. */
  createdBy: string;
  /** Connectors this agent is configured to use. */
  connectors: string[];
  /** When it was first launched (ISO). */
  createdAt: string;
  /** The dApp's HTTP endpoint (webhook kind only). Never includes secrets. */
  webhookUrl?: string;
  /** The agent's DID, once registered. */
  did: string;
  /** Live wallet balance in aETH minor units. */
  walletBalance: number;
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
    return [...this.agents.values()].map(({ config, running }) => {
      const id = makeWeb3Id(config.handle);
      const card = this.ctx.registry.get(id);
      return {
        handle: config.handle,
        web3Id: id,
        name: config.name,
        description: config.description,
        skill: config.skillId,
        price: config.price,
        provider: config.provider,
        model: config.model,
        kind: config.webhookUrl ? 'webhook' : 'llm',
        hasKey: Boolean(config.apiKey),
        running,
        createdBy: config.createdBy?.trim() || 'unknown',
        connectors: config.connectors ?? [],
        createdAt: config.createdAt ?? card?.createdAt ?? '',
        webhookUrl: config.webhookUrl,
        did: card?.did ?? '',
        walletBalance: this.ctx.ledger.balanceOf(id),
      };
    });
  }

  async launch(config: HostedAgentConfig, persist = true): Promise<HostedAgentStatus> {
    const id = makeWeb3Id(config.handle); // throws on a bad handle → caller maps to 400
    if (this.ctx.registry.has(id) && !this.agents.has(id)) {
      throw new Error(`${id} is already taken by another agent`);
    }
    // Respect the operator's contributed-capacity limit (set in the "my node" console).
    const limits = await this.ctx.store.loadSetting<{ maxAgents?: number }>('node-limits');
    const running = [...this.agents.values()].filter((a) => a.running).length;
    if (limits?.maxAgents && running >= limits.maxAgents && !this.agents.has(id)) {
      throw new Error(`node is at its hosting capacity (${limits.maxAgents} agents)`);
    }
    // Stamp the creation time on first launch (kept across restarts via the persisted config).
    const stamped: HostedAgentConfig = {
      ...config,
      createdAt: config.createdAt ?? this.ctx.clock(),
    };
    this.ensureRegistered(id, stamped);
    this.agents.set(id, { config: stamped, running: true });
    this.bindHandler(id, stamped);
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
      pricing: { perTask: config.price, currency: 'aETH' },
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
      output = config.webhookUrl
        ? await this.callWebhook(config.webhookUrl, m.body.input ?? { question })
        : {
            answer: await this.chat(
              {
                provider: config.provider,
                model: config.model,
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
                system: config.system,
              },
              question,
            ),
          };
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

  /** A dApp brain: POST the task input to the developer's endpoint, return its JSON response. */
  private async callWebhook(
    url: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) throw new Error(`dApp endpoint ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    // Accept { answer } or { output: {...} } or any object; normalise to an output shape.
    if (typeof data.answer === 'string') return { answer: data.answer };
    if (data.output && typeof data.output === 'object')
      return data.output as Record<string, unknown>;
    return data;
  }
}

interface HostedTaskMessage {
  from: string;
  body: { type: string; taskId: string; input?: { question?: string } };
}
