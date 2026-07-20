import { toMinorUnits } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
import WebSocket from 'ws';
import { Kernel } from '../src/kernel.js';
import { AccountsService } from '../src/services/accounts.js';
import { ConnectorsService } from '../src/services/connectors.js';
import { HostedAgentService } from '../src/services/hosted.js';
import { SkillsService } from '../src/services/skills.js';
import { TelegramService } from '../src/services/telegram.js';
import { MemoryStore } from '../src/store/index.js';
import { makeAgent, message, sealAs } from '../src/testkit.js';

describe('Web3.0 node (in-process integration)', () => {
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
    expect(receipt.settlement.network).toBe('web3-ledger');
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
    // A shared store + stable node keys stand in for a real MongoDB + WEB3_NODE_SEED across reboots.
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

  it('permissionless staking: stake to the escrow and the network seats the key automatically', async () => {
    const k = new Kernel(
      {
        port: 0,
        authorityStake: 50_000, // 500.00 aETH — reachable from the 1,000 aETH signup faucet
        consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9, slotMs: 0 },
      },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    const op = (await k.http
      .inject({
        method: 'POST',
        url: '/accounts/signup',
        payload: { local: 'staker', role: 'operator' },
      })
      .then((r) => r.json())) as { token: string; address: string };
    const candidateKey = toB64u(generateKeypair().publicKey);

    // signup minted a personal wallet with the faucet grant to stake from
    const info = (await k.http
      .inject({
        method: 'GET',
        url: `/operator/stake?key=${encodeURIComponent(candidateKey)}`,
        headers: { 'x-web3-token': op.token },
      })
      .then((r) => r.json())) as { walletBalance: number; staked: number; threshold: number };
    expect(info.walletBalance).toBe(k.config.faucetGrant);
    expect(info.staked).toBe(0);

    const stake = (payload: Record<string, unknown>) =>
      k.http.inject({
        method: 'POST',
        url: '/operator/stake',
        headers: { 'x-web3-token': op.token },
        payload,
      });

    // partial stake → not yet eligible; second stake defaults to the remaining amount
    const s1 = (await stake({ nodePublicKey: candidateKey, amount: 30_000 }).then((r) =>
      r.json(),
    )) as { staked: number; eligible: boolean };
    expect(s1).toMatchObject({ staked: 30_000, eligible: false });
    const s2 = (await stake({ nodePublicKey: candidateKey }).then((r) => r.json())) as {
      staked: number;
      eligible: boolean;
    };
    expect(s2).toMatchObject({ staked: 50_000, eligible: true });

    // the stake entries are on the ledger; the next proposed block seats the key — no admin
    const block = k.consensus.proposeTick();
    expect(block?.authorityAdd).toBe(candidateKey);
    expect(k.consensus.status().authorities).toContain(candidateKey);
    expect(k.consensus.stakeOf(candidateKey)).toBe(50_000);

    // an overdrawn stake is refused by the ledger
    expect((await stake({ nodePublicKey: candidateKey, amount: 10 ** 9 })).statusCode).toBe(400);
    await k.close();
  });

  it('faucet backfill grants pre-wallet accounts their signup aETH exactly once', async () => {
    // An account created before wallets existed: written straight to the store, no mint.
    const store = new MemoryStore();
    const nodeKeys = generateKeypair(); // stable identity across reboots (WEB3_NODE_SEED)
    const oldAccounts = new AccountsService(store, () => new Date().toISOString());
    await oldAccounts.load();
    await oldAccounts.signup('oldtimer', 'operator');

    const k1 = new Kernel({ port: 0 }, nodeKeys, store);
    await k1.init(); // backfill runs at module registration
    const balanceOf = (k: Kernel, id: string) =>
      k.http
        .inject({ method: 'GET', url: `/wallets/${encodeURIComponent(id)}` })
        .then((r) => (r.json() as { wallet?: { balance: number } }).wallet?.balance ?? 0);
    expect(await balanceOf(k1, 'oldtimer@web3.0')).toBe(k1.config.faucetGrant);

    // Spend it all, then reboot — the backfill must NOT re-grant (the mint is in history).
    k1.ledger.transfer(
      'oldtimer@web3.0' as Parameters<Kernel['ledger']['transfer']>[0],
      'stake@web3.0' as Parameters<Kernel['ledger']['transfer']>[0],
      k1.config.faucetGrant,
      { memo: 'authority-stake:test' },
    );
    expect(await balanceOf(k1, 'oldtimer@web3.0')).toBe(0);
    await k1.close();
    const k2 = new Kernel({ port: 0 }, nodeKeys, store);
    await k2.init();
    expect(await balanceOf(k2, 'oldtimer@web3.0')).toBe(0); // still zero — no double grant
    await k2.close();
  });

  it('collect sweeps treasury earnings into the admin wallet (operators are refused)', async () => {
    const k = new Kernel(
      {
        port: 0,
        fees: { protocolBps: 0, blockReward: 40_000, burnBps: 0, treasuryLocal: 'treasury' },
        consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9, slotMs: 0 },
      },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    const signup = (local: string, role: string) =>
      k.http
        .inject({ method: 'POST', url: '/accounts/signup', payload: { local, role } })
        .then((r) => r.json() as { token: string; address: string });
    const admin = await signup('owner', 'admin');
    const op = await signup('lodger', 'operator');

    // Produce a block → the reward lands in the treasury.
    k.consensus.proposeTick();
    const collect = (token: string) =>
      k.http.inject({
        method: 'POST',
        url: '/operator/collect',
        headers: { 'x-web3-token': token },
        payload: {},
      });

    expect((await collect(op.token)).statusCode).toBe(403); // not the node owner
    const ok = (await collect(admin.token).then((r) => r.json())) as { walletBalance: number };
    // wallet = signup faucet + the swept block reward
    expect(ok.walletBalance).toBe(k.config.faucetGrant + 40_000);
    expect((await collect(admin.token)).statusCode).toBe(400); // treasury now empty
    await k.close();
  });

  it('admin approval seats the authority on-chain via the next proposed block', async () => {
    const k = new Kernel(
      {
        port: 0,
        consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9, slotMs: 0 },
      },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    const signup = (local: string, role: string) =>
      k.http
        .inject({ method: 'POST', url: '/accounts/signup', payload: { local, role } })
        .then((r) => r.json() as { token: string; address: string });
    const admin = await signup('seatgov', 'admin');
    const op = await signup('candidate', 'operator');

    // The candidate's node key (a different machine's identity, not this node's own key).
    const candidateKey = toB64u(generateKeypair().publicKey);
    await k.http.inject({
      method: 'POST',
      url: '/operator/authority/request',
      headers: { 'x-web3-token': op.token },
      payload: { nodePublicKey: candidateKey },
    });

    // Approve → the coordinator queues an on-chain authorityAdd (this node IS an authority).
    const decided = (await k.http
      .inject({
        method: 'POST',
        url: '/operator/authority/decide',
        headers: { 'x-web3-token': admin.token },
        payload: { address: op.address, action: 'approve' },
      })
      .then((r) => r.json())) as { seated: boolean; seatNote: string };
    expect(decided.seated).toBe(true);

    // The next block this node proposes carries the membership change...
    await k.http.inject({
      method: 'POST',
      url: '/agents',
      payload: makeAgent('seed1').registration,
    });
    const block = k.consensus.proposeTick();
    expect(block?.authorityAdd).toBe(candidateKey);

    // ...and the live authority set now includes the new key; the chain still replays clean.
    expect(k.consensus.status().authorities).toContain(candidateKey);
    expect(k.consensus.engine!.chain.verifyChain()).toMatchObject({ ok: true });
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
    skills: new SkillsService(k.store, () => new Date().toISOString()),
    connectors: new ConnectorsService(k.store, () => new Date().toISOString()),
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

  it('/telegram/config is admin-gated when WEB3_ADMIN_TOKEN is set', async () => {
    process.env.WEB3_ADMIN_TOKEN = 'secret';
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
    process.env.WEB3_ADMIN_TOKEN = ''; // falsy → admin no longer required (avoid `delete`)
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
      {
        port: 0,
        fees: { protocolBps: 250, blockReward: 0, burnBps: 0, treasuryLocal: 'treasury' },
      },
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
      {
        port: 0,
        fees: { protocolBps: 250, blockReward: 0, burnBps: 0, treasuryLocal: 'treasury' },
      },
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
        fees: { protocolBps: 0, blockReward: 500, burnBps: 0, treasuryLocal: 'treasury' },
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
        headers: token ? { 'x-web3-token': token } : undefined,
      });

    // sign up a developer → gets an address + a one-time token
    const res = await post('/accounts/signup', { local: 'sanjay', role: 'developer' });
    expect(res.statusCode).toBe(201);
    const created = res.json() as { address: string; role: string; token: string };
    expect(created.address).toBe('sanjay@web3.0');
    expect(created.role).toBe('developer');
    expect(created.token).toMatch(/^web3_/);

    // the token authenticates /accounts/me and never leaks the hash
    const me = await k.http.inject({
      method: 'GET',
      url: '/accounts/me',
      headers: { 'x-web3-token': created.token },
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
        headers: token ? { 'x-web3-token': token } : undefined,
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
      headers: { 'x-web3-token': dev.token },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await k.http.inject({
      method: 'GET',
      url: '/accounts',
      headers: { 'x-web3-token': admin.token },
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

describe('hosted dApp ownership scoping', () => {
  it('scopes /hosted to the signed-in developer; admin sees all; anon launch rejected', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const signup = (local: string, role: string) =>
      k.http
        .inject({ method: 'POST', url: '/accounts/signup', payload: { local, role } })
        .then((r) => r.json() as { address: string; token: string });
    const admin = await signup('adm', 'admin');
    const dev1 = await signup('devone', 'developer');
    const dev2 = await signup('devtwo', 'developer');

    const launch = (token: string, handle: string) =>
      k.http.inject({
        method: 'POST',
        url: '/hosted/launch',
        headers: { 'x-web3-token': token },
        payload: {
          handle,
          name: 'D',
          description: '',
          skillId: 'ask',
          skillName: 'Ask',
          skillDesc: '',
          price: 100,
          provider: 'http',
          model: 'webhook',
          webhookUrl: 'http://127.0.0.1:1/x',
        },
      });
    expect((await launch(dev1.token, 'appone')).statusCode).toBe(200);

    const hosted = (token?: string) =>
      k.http
        .inject({
          method: 'GET',
          url: '/hosted',
          headers: token ? { 'x-web3-token': token } : undefined,
        })
        .then((r) => r.json() as { agents: { web3Id: string; createdBy: string }[] });

    const asDev1 = await hosted(dev1.token);
    expect(asDev1.agents.map((a) => a.web3Id)).toContain('appone@web3.0');
    expect(asDev1.agents.every((a) => a.createdBy === 'devone@web3.0')).toBe(true);

    expect((await hosted(dev2.token)).agents.length).toBe(0); // dev2 sees none of dev1's
    expect((await hosted(admin.token)).agents.map((a) => a.web3Id)).toContain('appone@web3.0');

    // a 'node operator' account (the default non-admin role) may publish and is scoped the same way
    const op = await signup('opp', 'operator');
    expect((await launch(op.token, 'opapp')).statusCode).toBe(200);
    const asOp = await hosted(op.token);
    expect(asOp.agents.map((a) => a.web3Id)).toContain('opapp@web3.0');
    expect(asOp.agents.some((a) => a.web3Id === 'appone@web3.0')).toBe(false); // not dev1's
    expect(asOp.agents.every((a) => a.createdBy === 'opp@web3.0')).toBe(true);

    const anon = await k.http.inject({
      method: 'POST',
      url: '/hosted/launch',
      payload: {
        handle: 'nope',
        name: '',
        description: '',
        skillId: 'ask',
        skillName: '',
        skillDesc: '',
        price: 0,
        provider: 'http',
        model: 'webhook',
        webhookUrl: 'http://x/y',
      },
    });
    expect(anon.statusCode).toBe(401); // once accounts exist, anonymous publish is blocked
    await k.close();
  });
});

describe('skill catalogue', () => {
  it('registers skills (auth required), rejects dupes/bad ids, and lists them', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const op = (await k.http
      .inject({
        method: 'POST',
        url: '/accounts/signup',
        payload: { local: 'opsmith', role: 'operator' },
      })
      .then((r) => r.json())) as { token: string; address: string };

    const create = (payload: Record<string, unknown>, token?: string) =>
      k.http.inject({
        method: 'POST',
        url: '/skills',
        headers: token ? { 'x-web3-token': token } : undefined,
        payload,
      });

    // anonymous create is blocked once accounts exist
    expect((await create({ id: 'summarize', name: 'Summarize' })).statusCode).toBe(401);
    // a signed-in operator can create; createdBy is stamped with their address
    const ok = await create(
      { id: 'summarize', name: 'Summarize', description: 'shorten text' },
      op.token,
    );
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { createdBy: string }).createdBy).toBe(op.address);
    // duplicate id and a bad id are rejected
    expect((await create({ id: 'summarize', name: 'Dup' }, op.token)).statusCode).toBe(400);
    expect((await create({ id: 'Bad Id!', name: 'X' }, op.token)).statusCode).toBe(400);

    const list = (await k.http.inject({ method: 'GET', url: '/skills' }).then((r) => r.json())) as {
      skills: { id: string }[];
    };
    expect(list.skills.map((s) => s.id)).toContain('summarize');
    await k.close();
  });
});

describe('connector registry', () => {
  it('adds custom connectors (auth required) and lists them; admin can delete', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const signup = (local: string, role: string) =>
      k.http
        .inject({ method: 'POST', url: '/accounts/signup', payload: { local, role } })
        .then((r) => r.json() as { token: string; address: string });
    const admin = await signup('boss', 'admin');
    const op = await signup('opsmith', 'operator');

    const add = (payload: Record<string, unknown>, token?: string) =>
      k.http.inject({
        method: 'POST',
        url: '/connectors',
        headers: token ? { 'x-web3-token': token } : undefined,
        payload,
      });

    expect((await add({ id: 'my-crm', name: 'My CRM' })).statusCode).toBe(401); // anon blocked
    const ok = await add({ id: 'my-crm', name: 'My CRM', category: 'Custom' }, op.token);
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { createdBy: string }).createdBy).toBe(op.address);

    const list = (await k.http
      .inject({ method: 'GET', url: '/connectors' })
      .then((r) => r.json())) as { connectors: { id: string }[] };
    expect(list.connectors.map((c) => c.id)).toContain('my-crm');

    // an operator cannot delete; an admin can
    const opDel = await k.http.inject({
      method: 'DELETE',
      url: '/connectors/my-crm',
      headers: { 'x-web3-token': op.token },
    });
    expect(opDel.statusCode).toBe(403);
    const adminDel = await k.http.inject({
      method: 'DELETE',
      url: '/connectors/my-crm',
      headers: { 'x-web3-token': admin.token },
    });
    expect(adminDel.statusCode).toBe(200);
    await k.close();
  });
});

describe('operator locations', () => {
  it('lets a signed-in operator set/update/clear their map position; list is public', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const op = (await k.http
      .inject({
        method: 'POST',
        url: '/accounts/signup',
        payload: { local: 'mapper', role: 'operator' },
      })
      .then((r) => r.json())) as { token: string; address: string };

    const put = (payload: Record<string, unknown>, token?: string) =>
      k.http.inject({
        method: 'PUT',
        url: '/operator/location',
        headers: token ? { 'x-web3-token': token } : undefined,
        payload,
      });

    // anonymous set is blocked; bad coordinates are rejected
    expect((await put({ lat: 13.08, lon: 80.27 })).statusCode).toBe(401);
    expect((await put({ lat: 123, lon: 80 }, op.token)).statusCode).toBe(400);
    expect((await put({ lat: 13, lon: 999 }, op.token)).statusCode).toBe(400);

    // a signed-in operator sets their position (Chennai); address is stamped server-side
    const ok = await put({ lat: 13.0827, lon: 80.2707, label: 'Chennai' }, op.token);
    expect(ok.statusCode).toBe(200);
    const loc = ok.json() as { address: string; label: string; lat: number; lon: number };
    expect(loc.address).toBe(op.address);
    expect(loc.label).toBe('Chennai');
    expect(loc.lat).toBeCloseTo(13.0827, 4);

    // update replaces (one location per account), and the list is public
    await put({ lat: 12.9716, lon: 77.5946, label: 'Bengaluru' }, op.token);
    const list = (await k.http
      .inject({ method: 'GET', url: '/operator/locations' })
      .then((r) => r.json())) as { locations: { address: string; label: string }[] };
    expect(list.locations).toHaveLength(1);
    expect(list.locations[0]!.label).toBe('Bengaluru');

    // clear removes it
    const del = await k.http.inject({
      method: 'DELETE',
      url: '/operator/location',
      headers: { 'x-web3-token': op.token },
    });
    expect(del.statusCode).toBe(200);
    const after = (await k.http
      .inject({ method: 'GET', url: '/operator/locations' })
      .then((r) => r.json())) as { locations: unknown[] };
    expect(after.locations).toHaveLength(0);
    await k.close();
  });
});

describe('node role + authority approvals', () => {
  it('reports the node role, and runs the request → admin approve/reject flow', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const signup = (local: string, role: string) =>
      k.http
        .inject({ method: 'POST', url: '/accounts/signup', payload: { local, role } })
        .then((r) => r.json() as { token: string; address: string });
    const admin = await signup('gov', 'admin');
    const op = await signup('hopeful', 'operator');

    // out of the box the node is solo (no shared chain configured)
    const node = (await k.http.inject({ method: 'GET', url: '/node' }).then((r) => r.json())) as {
      role: string;
      nodePublicKey: string;
    };
    expect(node.role).toBe('solo');
    expect(node.nodePublicKey.length).toBeGreaterThan(40);

    const ask = (token?: string) =>
      k.http.inject({
        method: 'POST',
        url: '/operator/authority/request',
        headers: token ? { 'x-web3-token': token } : undefined,
        payload: {},
      });

    // anonymous blocked; operator can request; duplicate pending blocked
    expect((await ask()).statusCode).toBe(401);
    const asked = await ask(op.token);
    expect(asked.statusCode).toBe(201);
    expect((asked.json() as { nodePublicKey: string }).nodePublicKey).toBe(node.nodePublicKey);
    expect((await ask(op.token)).statusCode).toBe(400);

    // queue is admin-only; the operator sees only their own status
    const opList = await k.http.inject({
      method: 'GET',
      url: '/operator/authority/requests',
      headers: { 'x-web3-token': op.token },
    });
    expect(opList.statusCode).toBe(403);
    const mine = (await k.http
      .inject({
        method: 'GET',
        url: '/operator/authority/mine',
        headers: { 'x-web3-token': op.token },
      })
      .then((r) => r.json())) as { request: { status: string } };
    expect(mine.request.status).toBe('pending');

    // admin rejects, operator may re-request, then admin approves
    const decide = (action: string) =>
      k.http.inject({
        method: 'POST',
        url: '/operator/authority/decide',
        headers: { 'x-web3-token': admin.token },
        payload: { address: op.address, action },
      });
    expect((await decide('reject')).statusCode).toBe(200);
    expect((await ask(op.token)).statusCode).toBe(201);
    const approved = await decide('approve');
    expect((approved.json() as { status: string; decidedBy: string }).status).toBe('approved');
    expect((approved.json() as { decidedBy: string }).decidedBy).toBe(admin.address);
    // once approved, a fresh request is refused
    expect((await ask(op.token)).statusCode).toBe(400);
    await k.close();
  });
});

describe('production economics + exit + slash + replication', () => {
  it('economics are GUI-editable at runtime: fee, burn and reward apply immediately', async () => {
    const k = new Kernel({ port: 0 }, generateKeypair(), new MemoryStore());
    await k.init();
    const admin = (await k.http
      .inject({
        method: 'POST',
        url: '/accounts/signup',
        payload: { local: 'policy', role: 'admin' },
      })
      .then((r) => r.json())) as { token: string };

    // defaults off → update via the API (no restart)
    const updated = (await k.http
      .inject({
        method: 'POST',
        url: '/operator/economics',
        headers: { 'x-web3-token': admin.token },
        payload: { feeBps: 100, burnBps: 50, blockReward: 1_000, authorityStake: 60_000 },
      })
      .then((r) => r.json())) as { feeBps: number; burnBps: number };
    expect(updated).toMatchObject({ feeBps: 100, burnBps: 50 });

    // a payment now pays 1% fee to treasury and burns 0.5%
    const a = makeAgent('feepay');
    const b = makeAgent('feeget');
    await k.http.inject({ method: 'POST', url: '/agents', payload: a.registration });
    await k.http.inject({ method: 'POST', url: '/agents', payload: b.registration });
    await k.http.inject({
      method: 'POST',
      url: '/pay',
      payload: sealAs(a, { from: a.web3Id, to: b.web3Id, amount: 10_000 }),
    });
    expect(k.ledger.balanceOf('treasury@web3.0' as never)).toBe(100);
    expect(k.ledger.balanceOf('burn@web3.0' as never)).toBe(50);
    // stats exclude the burn from circulating value and report it
    const stats = (await k.http.inject({ method: 'GET', url: '/stats' }).then((r) => r.json())) as {
      burned: number;
    };
    expect(stats.burned).toBe(50);
    await k.close();
  });

  it('unstake exits the authority set on-chain and refunds the escrow after cooldown', async () => {
    const k = new Kernel(
      {
        port: 0,
        authorityStake: 50_000,
        unstakeCooldownMs: 0, // instant maturity for the test; prod default is 24 h
        // slotMs > 0 so this node can step past the exiting authority's turn (proposer-skip)
        consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9, slotMs: 1 },
      },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    const op = (await k.http
      .inject({
        method: 'POST',
        url: '/accounts/signup',
        payload: { local: 'exiter', role: 'operator' },
      })
      .then((r) => r.json())) as { token: string; address: string };
    const key = toB64u(generateKeypair().publicKey);
    await k.http.inject({
      method: 'POST',
      url: '/operator/stake',
      headers: { 'x-web3-token': op.token },
      payload: { nodePublicKey: key },
    });
    k.consensus.proposeTick(); // seats the staked key
    expect(k.consensus.status().authorities).toContain(key);
    const before = k.ledger.balanceOf(op.address as never);

    const exit = await k.http.inject({
      method: 'POST',
      url: '/operator/unstake',
      headers: { 'x-web3-token': op.token },
      payload: { nodePublicKey: key },
    });
    expect(exit.statusCode).toBe(201);
    expect((exit.json() as { removalQueued: boolean }).removalQueued).toBe(true);
    // refund landed (cooldown 0) and the removal rides the next block
    expect(k.ledger.balanceOf(op.address as never)).toBe(before + 50_000);
    await k.http.inject({ method: 'POST', url: '/agents', payload: makeAgent('exx').registration });
    const block = k.consensus.proposeTick();
    expect(block?.authorityRemove).toBe(key);
    expect(k.consensus.status().authorities).not.toContain(key);
    // net stake for the key is now zero, so it will NOT be auto-re-seated
    expect(k.consensus.stakeOf(key)).toBe(0);
    // double-withdraw refused
    const again = await k.http.inject({
      method: 'POST',
      url: '/operator/unstake',
      headers: { 'x-web3-token': op.token },
      payload: { nodePublicKey: key },
    });
    expect(again.statusCode).toBe(400);
    await k.close();
  });

  it('slashes a double-signing authority: stake burned, removed from the set', async () => {
    // Network of A (this node) + B (a staked authority who will equivocate).
    const bKeys = generateKeypair();
    const bPub = toB64u(bKeys.publicKey);
    const k = new Kernel(
      {
        port: 0,
        authorityStake: 50_000,
        consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9, slotMs: 0 },
      },
      generateKeypair(),
      new MemoryStore(),
    );
    await k.init();
    const op = (await k.http
      .inject({
        method: 'POST',
        url: '/accounts/signup',
        payload: { local: 'villain', role: 'operator' },
      })
      .then((r) => r.json())) as { token: string };
    await k.http.inject({
      method: 'POST',
      url: '/operator/stake',
      headers: { 'x-web3-token': op.token },
      payload: { nodePublicKey: bPub },
    });
    const seatBlock = k.consensus.proposeTick()!; // block 0 seats B
    expect(seatBlock.authorityAdd).toBe(bPub);
    expect(k.consensus.stakeOf(bPub)).toBe(50_000);

    // B's turn at height 1: B signs TWO different blocks for the same height (equivocation).
    const { proposeBlock } = await import('@web3/consensus');
    const head = k.consensus.engine!.head();
    const ts = new Date().toISOString();
    const block1 = proposeBlock(bKeys, bPub, 1, head, [], ts);
    const block2 = proposeBlock(
      bKeys,
      bPub,
      1,
      head,
      [],
      `${ts.slice(0, -1)}9Z`.replace('Z9Z', '9Z'),
    );
    expect(block1.hash).not.toBe(block2.hash);
    expect(k.consensus.ingest(block1).ok).toBe(true); // first block commits normally
    const verdict = k.consensus.ingest(block2); // second is proof of double-signing
    expect(verdict.slashed).toBe(bPub);
    // stake burned to the sink, and the removal is queued for the next block A proposes
    expect(k.consensus.stakeOf(bPub)).toBe(0);
    expect(k.ledger.balanceOf('burn@web3.0' as never)).toBe(50_000);
    await k.http.inject({ method: 'POST', url: '/agents', payload: makeAgent('sl1').registration });
    const removalBlock = k.consensus.proposeTick();
    expect(removalBlock?.authorityRemove).toBe(bPub);
    expect(k.consensus.status().authorities).not.toContain(bPub);
    await k.close();
  });

  it('replicates committed foreign entries: balances converge across nodes', async () => {
    // Node A (authority) and node B (relay following the chain).
    const aKeys = generateKeypair();
    const aPub = toB64u(aKeys.publicKey);
    const mk = (keys: ReturnType<typeof generateKeypair>) =>
      new Kernel(
        {
          port: 0,
          consensus: { mode: 'poa', authorities: [aPub], peers: [], blockMs: 10 ** 9, slotMs: 0 },
        },
        keys,
        new MemoryStore(),
      );
    const nodeA = mk(aKeys);
    const nodeB = mk(generateKeypair());
    await nodeA.init();
    await nodeB.init();

    // Activity happens on A: two agents register and settle a payment.
    const alice = makeAgent('repa');
    const bob = makeAgent('repb');
    await nodeA.http.inject({ method: 'POST', url: '/agents', payload: alice.registration });
    await nodeA.http.inject({ method: 'POST', url: '/agents', payload: bob.registration });
    await nodeA.http.inject({
      method: 'POST',
      url: '/pay',
      payload: sealAs(alice, { from: alice.web3Id, to: bob.web3Id, amount: 4_000 }),
    });
    const block = nodeA.consensus.proposeTick()!;

    // B has never seen these agents — until the block lands and replication applies the entries.
    expect(nodeB.ledger.balanceOf(bob.web3Id as never)).toBe(0);
    expect(nodeB.consensus.ingest(block).ok).toBe(true);
    expect(nodeB.ledger.balanceOf(bob.web3Id as never)).toBe(
      nodeA.ledger.balanceOf(bob.web3Id as never),
    );
    expect(nodeB.ledger.balanceOf(alice.web3Id as never)).toBe(
      nodeA.ledger.balanceOf(alice.web3Id as never),
    );
    // Re-ingesting the same block (gossip replay / reconnect sync) is idempotent.
    nodeB.consensus.ingest(block);
    expect(nodeB.ledger.balanceOf(bob.web3Id as never)).toBe(
      nodeA.ledger.balanceOf(bob.web3Id as never),
    );
    await nodeA.close();
    await nodeB.close();
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
