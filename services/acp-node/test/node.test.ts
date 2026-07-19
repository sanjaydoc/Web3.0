import { toMinorUnits } from '@acp/core';
import { generateKeypair } from '@acp/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.ACP_LOG_LEVEL = 'silent';
import WebSocket from 'ws';
import { Kernel } from '../src/kernel.js';
import { AccountsService } from '../src/services/accounts.js';
import { HostedAgentService } from '../src/services/hosted.js';
import { TelegramService } from '../src/services/telegram.js';
import { MemoryStore } from '../src/store/index.js';
import { makeAgent, message, sealAs } from '../src/testkit.js';

describe('ACP node (in-process integration)', () => {
  let kernel: Kernel;

  beforeAll(async () => {
    // Ephemeral port, generous guardrails so tests don't trip limits by accident.
    kernel = new Kernel({ port: 0, host: '127.0.0.1' });
    await kernel.init();
  });

  afterAll(async () => {
    await kernel.close();
  });

  async function post(url: string, body: unknown) {
    const res = await kernel.http.inject({ method: 'POST', url, payload: body as object });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  }
  async function get(url: string) {
    const res = await kernel.http.inject({ method: 'GET', url });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  }

  it('registers an agent, issues a wallet with a faucet grant, and resolves the name', async () => {
    const alice = makeAgent('alice', { name: 'Alice' });
    const res = await post('/agents', alice.registration);
    expect(res.status).toBe(201);
    const wallet = (res.json.wallet as { balance: number }).balance;
    expect(wallet).toBe(kernel.config.faucetGrant);

    const resolved = await get('/resolve/alice@web3.0');
    expect(resolved.status).toBe(200);
    expect(resolved.json.did).toBe((res.json.card as { did: string }).did);
  });

  it('rejects a duplicate handle', async () => {
    const a = makeAgent('dupe');
    expect((await post('/agents', a.registration)).status).toBe(201);
    const b = makeAgent('dupe');
    expect((await post('/agents', b.registration)).status).toBe(409);
  });

  it('settles a signed payment between two agents', async () => {
    const payer = makeAgent('payer');
    const payee = makeAgent('payee');
    await post('/agents', payer.registration);
    await post('/agents', payee.registration);

    const envelope = sealAs(payer, {
      from: payer.web3Id,
      to: payee.web3Id,
      amount: toMinorUnits(12.5),
      memo: 'for a job well done',
    });
    const res = await post('/pay', envelope);
    expect(res.status).toBe(201);
    const receipt = res.json.receipt as {
      amount: number;
      ledgerHash: string;
      settlement: { network: string; status: string; txRef?: string };
    };
    expect(receipt.amount).toBe(1250);
    // Default rail is the internal ledger: the receipt carries a settled result tied to the entry.
    expect(receipt.settlement.network).toBe('acp-ledger');
    expect(receipt.settlement.status).toBe('settled');
    expect(receipt.settlement.txRef).toBe(receipt.ledgerHash);

    const payeeWallet = await get(`/wallets/${payee.web3Id}`);
    expect((payeeWallet.json.wallet as { balance: number }).balance).toBe(
      kernel.config.faucetGrant + 1250,
    );
  });

  it('blocks a payment that exceeds the spend cap (guardrail DENY)', async () => {
    const rich = makeAgent('rich');
    const sink = makeAgent('sink');
    await post('/agents', rich.registration);
    await post('/agents', sink.registration);

    const envelope = sealAs(rich, {
      from: rich.web3Id,
      to: sink.web3Id,
      amount: kernel.config.guardrails.spendCapPerWindow + 1,
    });
    const res = await post('/pay', envelope);
    expect(res.status).toBe(403);
    expect((res.json.verdict as { decision: string }).decision).toBe('DENY');
  });

  it('rejects a payment whose signature does not match the payer', async () => {
    const real = makeAgent('real');
    const impostor = makeAgent('impostor');
    await post('/agents', real.registration);
    await post('/agents', impostor.registration);

    // Impostor signs but claims to be `real`.
    const envelope = sealAs(impostor, {
      from: real.web3Id,
      to: impostor.web3Id,
      amount: 100,
    });
    const res = await post('/pay', envelope);
    expect(res.status).toBe(401);
  });

  it('routes a signed A2A task message from one agent to another over the relay', async () => {
    const address = await kernel.listen();
    const base = address.replace('http://', '');

    const sender = makeAgent('sender', {
      skills: [{ id: 'echo', name: 'Echo', description: 'echoes input', tags: [] }],
    });
    const worker = makeAgent('worker', {
      skills: [
        { id: 'summarise', name: 'Summarise', description: 'summarises text', tags: ['nlp'] },
      ],
    });
    await post('/agents', sender.registration);
    await post('/agents', worker.registration);

    const workerSocket = new WebSocket(`ws://${base}/relay`);
    const senderSocket = new WebSocket(`ws://${base}/relay`);

    const delivered = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for delivery')), 4000);
      workerSocket.on('message', (raw) => {
        const frame = JSON.parse(String(raw));
        if (frame.kind === 'deliver') {
          clearTimeout(timer);
          resolve(frame.message);
        }
      });
    });

    await Promise.all([once(workerSocket, 'open'), once(senderSocket, 'open')]);

    // Both authenticate with a signed hello.
    workerSocket.send(
      JSON.stringify({ kind: 'hello', envelope: sealAs(worker, { web3Id: worker.web3Id }) }),
    );
    senderSocket.send(
      JSON.stringify({ kind: 'hello', envelope: sealAs(sender, { web3Id: sender.web3Id }) }),
    );
    await waitForReady(workerSocket);
    await waitForReady(senderSocket);

    senderSocket.send(
      JSON.stringify({
        kind: 'send',
        envelope: message(sender, worker.web3Id, {
          type: 'task.submit',
          taskId: 't-1',
          skillId: 'summarise',
          input: { text: 'hello world' },
        }),
      }),
    );

    const msg = await delivered;
    expect((msg.body as { skillId: string }).skillId).toBe('summarise');
    expect(msg.from).toBe(sender.web3Id);

    workerSocket.close();
    senderSocket.close();
  });
});

describe('persistence (state survives a restart)', () => {
  it('restores agents, balances and a verified ledger from the store', async () => {
    // A shared store + stable node keys stand in for a real MongoDB + ACP_NODE_SEED across reboots.
    const store = new MemoryStore();
    const nodeKeys = generateKeypair();

    // --- first boot: register two agents and settle a payment ---
    const k1 = new Kernel({ port: 0 }, nodeKeys, store);
    await k1.init();
    const alice = makeAgent('palice');
    const bob = makeAgent('pbob');
    await k1.http.inject({ method: 'POST', url: '/agents', payload: alice.registration });
    await k1.http.inject({ method: 'POST', url: '/agents', payload: bob.registration });
    await k1.http.inject({
      method: 'POST',
      url: '/pay',
      payload: sealAs(alice, { from: alice.web3Id, to: bob.web3Id, amount: 700 }),
    });
    await k1.close(); // drains write-behind persistence

    // --- reboot: a fresh kernel over the same store + keys ---
    const k2 = new Kernel({ port: 0 }, nodeKeys, store);
    await k2.init();

    expect(k2.registry.size).toBe(3); // alice, bob, and the node treasury account
    expect(k2.registry.has(alice.web3Id)).toBe(true);
    expect(k2.ledger.balanceOf(alice.web3Id)).toBe(k2.config.faucetGrant - 700);
    expect(k2.ledger.balanceOf(bob.web3Id)).toBe(k2.config.faucetGrant + 700);
    expect(k2.ledger.verifyChain().ok).toBe(true);
    await k2.close();
  });

  it('refuses to hydrate a ledger signed by a different node key', async () => {
    const store = new MemoryStore();
    const k1 = new Kernel({ port: 0 }, generateKeypair(), store);
    await k1.init();
    await k1.http.inject({
      method: 'POST',
      url: '/agents',
      payload: makeAgent('pcarol').registration,
    });
    await k1.close();

    // Different node key → the persisted ledger's signatures won't verify.
    const k2 = new Kernel({ port: 0 }, generateKeypair(), store);
    await expect(k2.init()).rejects.toThrow(/hydrate a broken ledger|signature/);
  });
});

describe('auth & rate-limit hardening', () => {
  const fullAuth = (over: Partial<Kernel['config']['auth']> = {}) => ({
    enforce: true,
    freshnessMs: 120_000,
    clockSkewMs: 5_000,
    httpRateLimitPerWindow: 600,
    httpRateWindowMs: 60_000,
    ...over,
  });

  async function bootKernel(auth: Kernel['config']['auth']): Promise<Kernel> {
    const k = new Kernel({ port: 0, auth }, generateKeypair(), new MemoryStore());
    await k.init();
    return k;
  }
  const inject = (k: Kernel, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    k.http.inject({ method, url, payload: payload as object }).then((r) => r.statusCode);

  let kernel: Kernel;
  beforeAll(async () => {
    kernel = await bootKernel(fullAuth());
  });
  afterAll(async () => {
    await kernel.close();
  });

  it('rejects an unsigned registration when enforcing', async () => {
    const a = makeAgent('unsigned');
    expect(await inject(kernel, 'POST', '/agents', a.registrationBody)).toBe(401);
  });

  it('rejects a registration whose signing key does not match signPublicKey', async () => {
    const a = makeAgent('mismatch');
    const other = makeAgent('other');
    // Sign with a's key but claim other's signPublicKey — the wallet must not bind to a key you hold.
    const forged = sealAs(a, { ...a.registrationBody, signPublicKey: other.signPublicKey });
    expect(await inject(kernel, 'POST', '/agents', forged)).toBe(401);
  });

  it('rejects a replayed registration envelope (same nonce twice)', async () => {
    const a = makeAgent('replayreg');
    expect(await inject(kernel, 'POST', '/agents', a.registration)).toBe(201);
    // Re-post the identical signed envelope: the nonce is already spent.
    expect(await inject(kernel, 'POST', '/agents', a.registration)).toBe(401);
  });

  it('rejects a replayed payment envelope', async () => {
    const payer = makeAgent('rpayer');
    const payee = makeAgent('rpayee');
    await inject(kernel, 'POST', '/agents', payer.registration);
    await inject(kernel, 'POST', '/agents', payee.registration);
    const pay = sealAs(payer, { from: payer.web3Id, to: payee.web3Id, amount: 100 });
    expect(await inject(kernel, 'POST', '/pay', pay)).toBe(201);
    expect(await inject(kernel, 'POST', '/pay', pay)).toBe(401); // replay
  });

  it('rejects a stale payment envelope', async () => {
    const payer = makeAgent('spayer');
    const payee = makeAgent('spayee');
    await inject(kernel, 'POST', '/agents', payer.registration);
    await inject(kernel, 'POST', '/agents', payee.registration);
    const old = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago > freshnessMs
    const pay = sealAs(payer, { from: payer.web3Id, to: payee.web3Id, amount: 100 }, old);
    expect(await inject(kernel, 'POST', '/pay', pay)).toBe(401);
  });

  it('enforces a per-IP HTTP rate limit', async () => {
    const k = await bootKernel(fullAuth({ httpRateLimitPerWindow: 3 }));
    const statuses = [] as number[];
    for (let i = 0; i < 5; i++) statuses.push(await inject(k, 'GET', '/agents'));
    expect(statuses.slice(0, 3).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(3).every((s) => s === 429)).toBe(true);
    // /health is exempt even after the limit is blown.
    expect(await inject(k, 'GET', '/health')).toBe(200);
    await k.close();
  });

  it('warn-only mode logs but allows an unsigned registration', async () => {
    const k = await bootKernel(fullAuth({ enforce: false }));
    const a = makeAgent('warnonly');
    expect(await inject(k, 'POST', '/agents', a.registrationBody)).toBe(201);
    await k.close();
  });
});

describe('consensus (PoA)', () => {
  it('is off by default and reports status', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const res = await k.http.inject({ method: 'GET', url: '/consensus' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'off', enabled: false });
    await k.close();
  });

  it('batches ledger entries into a signed block when it is this authority turn', async () => {
    const k = new Kernel(
      {
        port: 0,
        consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9, slotMs: 0 },
      },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    // Sole authority → always our turn. Register an agent to append ledger entries.
    await k.http.inject({
      method: 'POST',
      url: '/agents',
      payload: makeAgent('cagent').registration,
    });

    const block = k.consensus.proposeTick();
    expect(block).not.toBeNull();
    expect(block!.height).toBe(0);
    expect(block!.entries.length).toBeGreaterThan(0);
    expect(k.consensus.engine!.chain.verifyChain()).toMatchObject({ ok: true });

    const status = k.consensus.status();
    expect(status).toMatchObject({ mode: 'poa', enabled: true, height: 1 });
    expect(status.authorities).toContain(status.authority);
    await k.close();
  });
});

function ctxOf(k: Kernel) {
  return {
    http: k.http,
    ledger: k.ledger,
    registry: k.registry,
    bus: k.bus,
    guardrails: k.guardrails,
    replay: k.replay,
    settlement: k.settlement,
    consensus: k.consensus,
    connections: k.connections,
    store: k.store,
    accounts: new AccountsService(k.store, () => new Date().toISOString()),
    config: k.config,
    treasuryId: k.treasuryId,
    clock: () => new Date().toISOString(),
    log: k.http.log,
  };
}

describe('telegram bridge (GUI-managed, in-node)', () => {
  it('config masks the token, never returning it, and persists to the store', async () => {
    const store = new MemoryStore();
    const k = new Kernel({ port: 0 }, generateKeypair(), store);
    await k.init();
    const svc = new TelegramService(ctxOf(k) as never);
    const status = await svc.setConfig({ token: '123456789', enabled: false, botLocal: 'tgx' });
    expect(status.tokenSet).toBe(true);
    expect(status.tokenHint).toBe('…6789');
    expect(JSON.stringify(status)).not.toContain('123456789'); // secret never surfaced

    // Persisted: a fresh service over the same store recovers the (masked) config.
    const svc2 = new TelegramService(ctxOf(k) as never);
    await svc2.load();
    expect(svc2.status().tokenSet).toBe(true);
    expect(svc2.status().botLocal).toBe('tgx');
    await k.close();
  });

  it('/telegram/config is admin-gated when ACP_ADMIN_TOKEN is set', async () => {
    process.env.ACP_ADMIN_TOKEN = 'secret';
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const noAuth = await k.http.inject({ method: 'POST', url: '/telegram/config', payload: {} });
    expect(noAuth.statusCode).toBe(401);
    const withAuth = await k.http.inject({
      method: 'POST',
      url: '/telegram/config',
      headers: { 'x-admin-token': 'secret' },
      payload: { botLocal: 'okbot' },
    });
    expect(withAuth.statusCode).toBe(200);
    await k.close();
    process.env.ACP_ADMIN_TOKEN = ''; // falsy → admin no longer required (avoid `delete`)
  });

  it('bridges /ask to an agent: pays it and returns its answer', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const svc = new TelegramService(ctxOf(k) as never);

    // Register an "echo" agent with an ask skill + price, and a virtual connection that replies.
    const echo = makeAgent('echobot', {
      skills: [{ id: 'ask', name: 'Ask', description: 'echoes', tags: [] }],
      pricing: { perTask: 200, currency: 'aETH' },
    });
    await k.http.inject({ method: 'POST', url: '/agents', payload: echo.registration });
    const echoConn = {
      readyState: 1,
      OPEN: 1,
      send: (raw: string) => {
        const f = JSON.parse(raw);
        if (f.kind === 'deliver' && f.message.body.type === 'task.submit') {
          k.connections.sendTo(f.message.from, {
            kind: 'deliver',
            message: {
              id: 'r',
              from: echo.web3Id,
              to: f.message.from,
              ts: '',
              body: {
                type: 'task.result',
                taskId: f.message.body.taskId,
                state: 'completed',
                output: { answer: `echo: ${f.message.body.input.question}` },
              },
            },
          });
        }
      },
    };
    k.connections.bind(echo.web3Id, echoConn as never);

    const answer = await svc.ask('echobot', 'hello acp', 3000);
    expect(answer).toBe('echo: hello acp');
    // The bridge paid the agent from its faucet-funded wallet.
    expect(k.ledger.balanceOf(echo.web3Id)).toBe(k.config.faucetGrant + 200);
    await k.close();
  });
});

describe('hosted agents (Genesis launch on node)', () => {
  it('launches an agent that answers tasks with its LLM brain, and persists it', async () => {
    const store = new MemoryStore();
    const k = new Kernel({ port: 0 }, generateKeypair(), store);
    await k.init();
    const chat = async (_cfg: unknown, prompt: string) => `brain says: ${prompt}`;
    const svc = new HostedAgentService(ctxOf(k) as never, chat);

    const status = await svc.launch({
      handle: 'genagent',
      name: 'Gen',
      description: 'an llm agent',
      skillId: 'ask',
      skillName: 'Ask',
      skillDesc: 'answers',
      price: 150,
      provider: 'local',
      model: 'x',
      apiKey: 'secret-key',
      system: 'be helpful',
    });
    expect(status.web3Id).toBe('genagent@web3.0');
    expect(status.running).toBe(true);
    expect(status.hasKey).toBe(true);
    // The API key must never appear in the status surface.
    expect(JSON.stringify(status)).not.toContain('secret-key');
    expect(k.registry.has('genagent@web3.0' as never)).toBe(true);

    // A sender routes a task to the hosted agent; capture the LLM-backed reply.
    const senderId = 'asker@web3.0';
    const got = new Promise<Record<string, unknown>>((resolve) => {
      const senderConn = {
        readyState: 1,
        OPEN: 1,
        send: (raw: string) => {
          const f = JSON.parse(raw);
          if (f.message?.body?.type === 'task.result') resolve(f.message.body);
        },
      };
      k.connections.bind(senderId as never, senderConn as never);
    });
    k.connections.sendTo('genagent@web3.0' as never, {
      kind: 'deliver',
      message: {
        id: 'm',
        from: senderId,
        to: 'genagent@web3.0',
        ts: '',
        body: { type: 'task.submit', taskId: 't1', skillId: 'ask', input: { question: 'hello' } },
      },
    });
    const result = (await Promise.race([
      got,
      new Promise((r) => setTimeout(() => r({ output: { error: 'timeout' } }), 3000)),
    ])) as { output: { answer?: string } };
    expect(result.output.answer).toBe('brain says: hello');

    // Persisted (with key server-side): a fresh service over the same store relaunches it.
    const svc2 = new HostedAgentService(ctxOf(k) as never, chat);
    await svc2.load();
    expect(svc2.status().some((a) => a.web3Id === 'genagent@web3.0')).toBe(true);
    await k.close();
  });

  it('publishes a webhook dApp that forwards tasks to an external endpoint', async () => {
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const { input } = JSON.parse(body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ answer: `dapp: ${input.question}` }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const svc = new HostedAgentService(ctxOf(k) as never);
    const status = await svc.launch({
      handle: 'webdapp',
      name: 'Web dApp',
      description: 'external endpoint',
      skillId: 'ask',
      skillName: 'Ask',
      skillDesc: 'x',
      price: 0,
      provider: 'http',
      model: 'webhook',
      webhookUrl: `http://127.0.0.1:${port}`,
      createdBy: 'Dr. Sanjay Anbu',
    });
    expect(status.kind).toBe('webhook');
    // Catalogue metadata surfaces for the Hosted dApps view.
    expect(status.createdBy).toBe('Dr. Sanjay Anbu');
    expect(status.createdAt).not.toBe('');
    expect(status.webhookUrl).toBe(`http://127.0.0.1:${port}`);
    expect(status.did).not.toBe('');
    expect(typeof status.walletBalance).toBe('number');

    const senderId = 'caller@web3.0';
    const got = new Promise<{ output: { answer?: string } }>((resolve) => {
      k.connections.bind(
        senderId as never,
        {
          readyState: 1,
          OPEN: 1,
          send: (raw: string) => {
            const f = JSON.parse(raw);
            if (f.message?.body?.type === 'task.result') resolve(f.message.body);
          },
        } as never,
      );
    });
    k.connections.sendTo('webdapp@web3.0' as never, {
      kind: 'deliver',
      message: {
        id: 'm',
        from: senderId,
        to: 'webdapp@web3.0',
        ts: '',
        body: { type: 'task.submit', taskId: 't1', input: { question: 'ping' } },
      },
    });
    const result = (await Promise.race([
      got,
      new Promise((r) => setTimeout(() => r({ output: { error: 'timeout' } }), 3000)),
    ])) as { output: { answer?: string } };
    expect(result.output.answer).toBe('dapp: ping');
    server.close();
    await k.close();
  });

  it('rejects an invalid handle with a clear error', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const svc = new HostedAgentService(ctxOf(k) as never, async () => 'x');
    await expect(
      svc.launch({
        handle: 'x', // too short → invalid Web3.0 ID
        name: 'X',
        description: '',
        skillId: 'ask',
        skillName: 'Ask',
        skillDesc: '',
        price: 0,
        provider: 'local',
        model: 'x',
      }),
    ).rejects.toThrow();
    await k.close();
  });
});

describe('operator console (my node)', () => {
  it('reports earnings, resources, and persists contribution limits', async () => {
    const k = new Kernel(
      { port: 0, fees: { protocolBps: 250, blockReward: 0, treasuryLocal: 'treasury' } },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    const inject = (url: string, payload?: unknown) =>
      k.http.inject({ method: 'POST', url, payload: payload as object });

    // one payment → a 2.5% fee accrues to the treasury
    const payer = makeAgent('opayer');
    const payee = makeAgent('opayee');
    await inject('/agents', payer.registration);
    await inject('/agents', payee.registration);
    await inject('/pay', sealAs(payer, { from: payer.web3Id, to: payee.web3Id, amount: 1000 }));

    const node = (await k.http.inject({ method: 'GET', url: '/node' })).json() as {
      earnings: { fees: number; balance: number };
      resources: { processRssMb: number; uptimeSec: number };
      limits: { maxAgents: number };
    };
    expect(node.earnings.fees).toBe(25);
    expect(node.earnings.balance).toBe(25);
    expect(node.resources.processRssMb).toBeGreaterThan(0);
    expect(node.resources.uptimeSec).toBeGreaterThanOrEqual(0);

    // set a contribution limit and read it back
    const saved = (await inject('/node/limits', { maxAgents: 5, maxRamMb: 2048 })).json() as {
      maxAgents: number;
      maxRamMb: number;
    };
    expect(saved).toMatchObject({ maxAgents: 5, maxRamMb: 2048 });
    const again = (await k.http.inject({ method: 'GET', url: '/node' })).json() as {
      limits: { maxAgents: number };
    };
    expect(again.limits.maxAgents).toBe(5);
    await k.close();
  });
});

describe('operator incentives (fees & block rewards)', () => {
  it('skims a protocol fee from each payment to the node treasury', async () => {
    const k = new Kernel(
      { port: 0, fees: { protocolBps: 250, blockReward: 0, treasuryLocal: 'treasury' } },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    const inject = (url: string, payload: unknown) =>
      k.http.inject({ method: 'POST', url, payload: payload as object });

    const payer = makeAgent('feepayer');
    const payee = makeAgent('feepayee');
    await inject('/agents', payer.registration);
    await inject('/agents', payee.registration);

    const res = await inject(
      '/pay',
      sealAs(payer, { from: payer.web3Id, to: payee.web3Id, amount: 1000 }),
    );
    const receipt = res.json().receipt as { fee: number; netToPayee: number };
    expect(receipt.fee).toBe(25); // 2.5% of 1000
    expect(receipt.netToPayee).toBe(975);
    expect(k.ledger.balanceOf(payee.web3Id)).toBe(k.config.faucetGrant + 975);
    expect(k.ledger.balanceOf(k.treasuryId as never)).toBe(25);
    await k.close();
  });

  it('mints a block reward to the treasury when this node proposes', async () => {
    const k = new Kernel(
      {
        port: 0,
        consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9, slotMs: 0 },
        fees: { protocolBps: 0, blockReward: 500, treasuryLocal: 'treasury' },
      },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    await k.http.inject({
      method: 'POST',
      url: '/agents',
      payload: makeAgent('rewardee').registration,
    });

    expect(k.ledger.balanceOf(k.treasuryId as never)).toBe(0);
    const block = k.consensus.proposeTick();
    expect(block).not.toBeNull();
    expect(k.ledger.balanceOf(k.treasuryId as never)).toBe(500); // block reward minted
    await k.close();
  });
});

describe('accounts & authentication', () => {
  it('signs up an account, mints a one-time token, and authenticates it', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const post = (url: string, payload: unknown, token?: string) =>
      k.http.inject({
        method: 'POST',
        url,
        payload: payload as object,
        headers: token ? { 'x-acp-token': token } : undefined,
      });

    // sign up a developer → gets an address + a one-time token
    const res = await post('/accounts/signup', { local: 'sanjay', role: 'developer' });
    expect(res.statusCode).toBe(201);
    const created = res.json() as { address: string; role: string; token: string };
    expect(created.address).toBe('sanjay@web3.0');
    expect(created.role).toBe('developer');
    expect(created.token).toMatch(/^acp_/);

    // the token authenticates /accounts/me and never leaks the hash
    const me = await k.http.inject({
      method: 'GET',
      url: '/accounts/me',
      headers: { 'x-acp-token': created.token },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ address: 'sanjay@web3.0', role: 'developer' });
    expect(JSON.stringify(me.json())).not.toContain('tokenHash');

    // no/!bad token → 401
    const anon = await k.http.inject({ method: 'GET', url: '/accounts/me' });
    expect(anon.statusCode).toBe(401);
    await k.close();
  });

  it('enforces roles: only an admin may list accounts, and the taken address is rejected', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const post = (url: string, payload: unknown, token?: string) =>
      k.http.inject({
        method: 'POST',
        url,
        payload: payload as object,
        headers: token ? { 'x-acp-token': token } : undefined,
      });

    const admin = (await post('/accounts/signup', { local: 'boss', role: 'admin' })).json() as {
      token: string;
    };
    const dev = (await post('/accounts/signup', { local: 'devy', role: 'developer' })).json() as {
      token: string;
    };

    // a developer cannot list accounts; the admin can
    const denied = await k.http.inject({
      method: 'GET',
      url: '/accounts',
      headers: { 'x-acp-token': dev.token },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await k.http.inject({
      method: 'GET',
      url: '/accounts',
      headers: { 'x-acp-token': admin.token },
    });
    expect(allowed.statusCode).toBe(200);
    expect((allowed.json() as { accounts: unknown[] }).accounts.length).toBe(2);

    // once an admin exists, minting another admin requires admin auth
    const forbidden = await post('/accounts/signup', { local: 'boss2', role: 'admin' });
    expect(forbidden.statusCode).toBe(401);
    const okAdmin = await post('/accounts/signup', { local: 'boss2', role: 'admin' }, admin.token);
    expect(okAdmin.statusCode).toBe(201);

    // duplicate address is rejected
    const dup = await post('/accounts/signup', { local: 'devy', role: 'developer' });
    expect(dup.statusCode).toBe(400);

    // accounts persist across a restart over the same store
    const svc = new AccountsService(k.store, () => new Date().toISOString());
    await svc.load();
    expect(svc.get('boss@web3.0')?.role).toBe('admin');
    await k.close();
  });
});

function once(socket: WebSocket, event: string): Promise<void> {
  return new Promise((resolve) => socket.once(event, () => resolve()));
}

function waitForReady(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no ready frame')), 4000);
    socket.on('message', function onMsg(raw) {
      const frame = JSON.parse(String(raw));
      if (frame.kind === 'ready') {
        clearTimeout(timer);
        socket.off('message', onMsg);
        resolve();
      }
    });
  });
}
