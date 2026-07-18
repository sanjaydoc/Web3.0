import { toMinorUnits } from '@acp/core';
import { generateKeypair } from '@acp/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.ACP_LOG_LEVEL = 'silent';
import WebSocket from 'ws';
import { Kernel } from '../src/kernel.js';
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

    expect(k2.registry.size).toBe(2);
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
      { port: 0, consensus: { mode: 'poa', authorities: [], peers: [], blockMs: 10 ** 9 } },
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
