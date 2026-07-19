import { AGENT_CARD_VERSION, formatAmount, web3Id as makeWeb3Id } from '@web3/core';
import type { AgentCard, Web3Id } from '@web3/core';
import { deriveDid, generateKemKeypair, generateKeypair, randomId, toB64u } from '@web3/crypto';
import { InsufficientFundsError } from '@web3/ledger';
import type { WebSocket } from 'ws';
import type { ModuleContext } from '../context.js';

/** GUI-managed Telegram config, persisted in the Store (never in .env). */
export interface TelegramConfig {
  enabled: boolean;
  /** Bot token from @BotFather. Stored server-side; never returned to clients in full. */
  token: string;
  /** Local part of the bridge agent's Web3.0 ID (its wallet pays the agents it queries). */
  botLocal: string;
  /** Skill id the bridge submits for /ask. */
  skill: string;
}

const DEFAULTS: TelegramConfig = {
  enabled: false,
  token: '',
  botLocal: 'telegrambot',
  skill: 'ask',
};
const SETTING_KEY = 'telegram';

export interface TelegramStatus {
  enabled: boolean;
  running: boolean;
  tokenSet: boolean;
  tokenHint: string | null;
  botUsername: string | null;
  botLocal: string;
  skill: string;
  bridgeId: string;
  lastError: string | null;
}

/**
 * The Telegram front door, running *inside* the node and managed entirely from the dashboard — no
 * .env, no separate process. It bridges humans to ACP agents: it registers an internal "bridge"
 * agent (with a wallet), receives a virtual relay connection so replies route back to it, and for
 * `/ask` pays the target over the ledger and routes a task, awaiting the result.
 */
export class TelegramService {
  private config: TelegramConfig = { ...DEFAULTS };
  private running = false;
  private offset = 0;
  private botUsername: string | null = null;
  private lastError: string | null = null;
  private abort: AbortController | null = null;
  private readonly pending = new Map<string, (output: Record<string, unknown>) => void>();
  private bridgeId: Web3Id;
  private bound = false;

  constructor(private readonly ctx: ModuleContext) {
    this.bridgeId = makeWeb3Id(DEFAULTS.botLocal);
  }

  /** Load persisted config on boot and auto-start if it was left enabled. */
  async load(): Promise<void> {
    const saved = await this.ctx.store.loadSetting<TelegramConfig>(SETTING_KEY);
    if (saved) this.config = { ...DEFAULTS, ...saved };
    this.bridgeId = makeWeb3Id(this.config.botLocal);
    if (this.config.enabled && this.config.token) await this.start();
  }

  status(): TelegramStatus {
    const t = this.config.token;
    return {
      enabled: this.config.enabled,
      running: this.running,
      tokenSet: Boolean(t),
      tokenHint: t ? `…${t.slice(-4)}` : null,
      botUsername: this.botUsername,
      botLocal: this.config.botLocal,
      skill: this.config.skill,
      bridgeId: this.bridgeId,
      lastError: this.lastError,
    };
  }

  /** Update config from the dashboard. An omitted/blank token keeps the stored one. */
  async setConfig(patch: Partial<TelegramConfig>): Promise<TelegramStatus> {
    const next: TelegramConfig = { ...this.config };
    if (typeof patch.botLocal === 'string' && patch.botLocal.trim())
      next.botLocal = patch.botLocal.trim();
    if (typeof patch.skill === 'string' && patch.skill.trim()) next.skill = patch.skill.trim();
    if (typeof patch.token === 'string' && patch.token.trim()) next.token = patch.token.trim();
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;

    await this.stop();
    this.config = next;
    this.bridgeId = makeWeb3Id(next.botLocal);
    await this.ctx.store.saveSetting(SETTING_KEY, next);
    if (next.enabled && next.token) await this.start();
    return this.status();
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.config.token) throw new Error('a bot token is required to start');
    this.ensureBridge();
    this.lastError = null;
    this.running = true;
    this.abort = new AbortController();
    void this.pollLoop();
    this.ctx.log.info(`telegram: bridge started as ${this.bridgeId}`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort?.abort();
    this.abort = null;
  }

  // ── bridge internals ───────────────────────────────────────────────────────────────────────

  /** Idempotently make sure the bridge agent exists and its virtual relay connection is bound. */
  private ensureBridge(): void {
    this.ensureBridgeAgent();
    this.bindVirtualConnection();
  }

  private ensureBridgeAgent(): void {
    if (this.ctx.registry.has(this.bridgeId)) return;
    const keys = generateKeypair();
    const kem = generateKemKeypair();
    const did = deriveDid(keys.publicKey);
    const card: AgentCard = {
      web3Id: this.bridgeId,
      did,
      name: 'Telegram Bridge',
      description: 'Bridges humans on Telegram to ACP agents.',
      kind: 'agent',
      skills: [],
      signPublicKey: toB64u(keys.publicKey),
      kemPublicKey: toB64u(kem.publicKey),
      version: AGENT_CARD_VERSION,
      createdAt: this.ctx.clock(),
    };
    this.ctx.registry.add(card);
    void this.ctx.store.saveAgent(card);
    this.ctx.ledger.register(this.bridgeId, did, this.ctx.config.faucetGrant);
  }

  /** Bind a virtual relay connection so replies routed to the bridge resolve pending /ask calls. */
  private bindVirtualConnection(): void {
    if (this.bound) return;
    const virtual = {
      readyState: 1,
      OPEN: 1,
      send: (raw: string) => {
        try {
          const frame = JSON.parse(raw) as {
            kind?: string;
            message?: { body?: Record<string, unknown> };
          };
          const body = frame.message?.body;
          if (frame.kind === 'deliver' && body?.type === 'task.result') {
            const resolve = this.pending.get(String(body.taskId));
            if (resolve) {
              this.pending.delete(String(body.taskId));
              resolve((body.output as Record<string, unknown>) ?? {});
            }
          }
        } catch {
          /* ignore malformed frames */
        }
      },
    } as unknown as WebSocket;
    this.ctx.connections.bind(this.bridgeId, virtual);
    this.bound = true;
  }

  async ask(target: string, question: string, timeoutMs = 60_000): Promise<string> {
    this.ensureBridge();
    const to = (target.includes('@') ? target : `${target}@web3.0`) as Web3Id;
    const card = this.ctx.registry.get(to);
    if (!card) return `⚠️ no agent named ${to}`;
    if (!card.skills.some((s) => s.id === this.config.skill)) {
      return `⚠️ ${to} does not offer "${this.config.skill}"`;
    }
    const price = card.pricing?.perTask ?? 0;
    if (price > 0) {
      try {
        this.ctx.ledger.transfer(this.bridgeId, to, price, { memo: this.config.skill });
      } catch (err) {
        if (err instanceof InsufficientFundsError) return "⚠️ the bridge wallet can't cover the fee";
        throw err;
      }
    }
    const taskId = randomId('tg');
    const message = {
      id: randomId('msg'),
      from: this.bridgeId,
      to,
      ts: this.ctx.clock(),
      body: { type: 'task.submit', taskId, skillId: this.config.skill, input: { question } },
    };
    this.ctx.ledger.recordMessage({
      messageId: message.id,
      from: this.bridgeId,
      to,
      bodyType: 'task.submit',
      contentHash: taskId,
    });
    const answer = new Promise<Record<string, unknown>>((resolve) =>
      this.pending.set(taskId, resolve),
    );
    this.ctx.connections.sendTo(to, { kind: 'deliver', message });
    const output = await Promise.race([
      answer,
      new Promise<Record<string, unknown>>((resolve) =>
        setTimeout(() => resolve({ __timeout: true }), timeoutMs),
      ),
    ]);
    this.pending.delete(taskId);
    if (output.__timeout) return '⏳ no answer in time — the agent may be offline.';
    return (output.answer as string) ?? `⚠️ ${to} failed: ${output.error ?? 'unknown error'}`;
  }

  handleCommand(text: string): Promise<string> {
    return this.route(text.trim());
  }

  private async route(text: string): Promise<string> {
    if (!text) return HELP;
    const [cmd, ...rest] = text.split(/\s+/);
    switch ((cmd ?? '').toLowerCase()) {
      case '/start':
      case '/help':
        return HELP;
      case '/whoami':
        return `bridge \`${this.bridgeId}\`\nwallet: ${formatAmount(this.ctx.ledger.balanceOf(this.bridgeId))}`;
      case '/agents': {
        const agents = this.ctx.registry.list();
        if (agents.length === 0) return 'no agents registered yet.';
        return `*Agents on ACP:*\n${agents
          .map(
            (a) =>
              `• \`${a.web3Id}\` — ${a.name}${a.skills.length ? ` [${a.skills.map((s) => s.id).join(', ')}]` : ''}`,
          )
          .join('\n')}`;
      }
      case '/ask': {
        if (rest.length < 2) return 'usage: /ask <agent> <question>';
        return this.ask(rest[0]!, rest.slice(1).join(' '));
      }
      default:
        return `unknown command "${cmd}"\n\n${HELP}`;
    }
  }

  // ── Telegram transport (global fetch) ────────────────────────────────────────────────────────

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.config.token}/${method}`;
  }

  private async pollLoop(): Promise<void> {
    try {
      const me = await fetch(this.api('getMe')).then((r) => r.json());
      this.botUsername = me?.result?.username ?? null;
    } catch {
      /* getMe is best-effort */
    }
    while (this.running) {
      try {
        const res = await fetch(`${this.api('getUpdates')}?timeout=50&offset=${this.offset}`, {
          signal: this.abort?.signal,
        });
        const data = (await res.json()) as { result?: TgUpdate[] };
        for (const update of data.result ?? []) {
          this.offset = update.update_id + 1;
          const text = update.message?.text;
          const chatId = update.message?.chat?.id;
          if (text && chatId !== undefined) {
            const reply = await this.handleCommand(text);
            await this.send(chatId, reply);
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  }

  private async send(chatId: number, text: string): Promise<void> {
    const url = `${this.api('sendMessage')}?chat_id=${chatId}&parse_mode=Markdown&text=${encodeURIComponent(text)}`;
    await fetch(url).catch(() => undefined);
  }
}

interface TgUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number } };
}

const HELP =
  '🤖 *ACP bridge*\n' +
  '/agents — list agents on the network\n' +
  '/whoami — the bridge Web3.0 ID and balance\n' +
  '/ask <agent> <question> — pay an agent and get an answer';
