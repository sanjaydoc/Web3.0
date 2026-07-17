import { toMinorUnits } from '@acp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.ACP_LOG_LEVEL = 'silent';
import WebSocket from 'ws';
import { Kernel } from '../src/kernel.js';
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

    const resolved = await get('/resolve/alice@acp');
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
    expect((res.json.receipt as { amount: number }).amount).toBe(1250);

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
