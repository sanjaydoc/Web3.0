import { generateKeypair } from '@web3/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
process.env.WEB3_ADMIN_TOKEN = '';
process.env.WEB3_AUTH_ENFORCE = '0';
process.env.WEB3_STORE_MODE_FILE = '/nonexistent/web3-erc8004/store-mode';
import { Kernel } from '../src/kernel.js';
import { MemoryStore } from '../src/store/index.js';
import { makeAgent } from '../src/testkit.js';

let kernel: Kernel;
let base: string;

beforeAll(async () => {
  kernel = new Kernel(
    { port: 0, host: '127.0.0.1' },
    generateKeypair(new Uint8Array(32).fill(5)),
    new MemoryStore(),
  );
  await kernel.init();
  base = await kernel.listen();
});
afterAll(async () => {
  await kernel.close();
});

// Register a Web3.0 agent via the real signed-envelope join flow (testkit builds the envelope).
async function registerAgent(local: string) {
  const agent = makeAgent(local, {
    name: `${local} agent`,
    description: 'test agent',
    skills: [{ id: 'summarise', name: 'Summarise', description: 's', tags: ['nlp'] }],
  });
  return fetch(`${base}/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(agent.registration),
  });
}

describe('node erc8004 module', () => {
  it('auto-mints an ERC-8004 identity when an agent joins', async () => {
    const reg = await registerAgent('alice');
    expect(reg.status).toBe(201);

    const list = (await (await fetch(`${base}/erc8004/agents`)).json()) as {
      count: number;
      registry: string;
      agents: Array<{ agentId: number; agentDomain: string; agentAddress: string }>;
    };
    expect(list.count).toBeGreaterThanOrEqual(1);
    const alice = list.agents.find((a) => a.agentDomain === 'alice@web3.0');
    expect(alice).toBeTruthy();
    expect(alice?.agentAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('resolves by domain and serves an ERC-8004 registration file', async () => {
    const resolved = (await (
      await fetch(`${base}/erc8004/resolve?domain=alice@web3.0`)
    ).json()) as { agentId: number };
    expect(resolved.agentId).toBeGreaterThanOrEqual(1);

    const card = (await (
      await fetch(`${base}/erc8004/agents/${resolved.agentId}/card`)
    ).json()) as {
      registrations: Array<{ agentId: number }>;
      trustModels: string[];
      web3?: { did?: string };
    };
    expect(card.registrations[0]?.agentId).toBe(resolved.agentId);
    expect(card.trustModels).toContain('feedback');
    expect(card.web3?.did).toMatch(/^did:web3:/);
  });

  it('records reputation feedback and aggregates a score', async () => {
    const { agentId } = (await (
      await fetch(`${base}/erc8004/resolve?domain=alice@web3.0`)
    ).json()) as {
      agentId: number;
    };
    for (const [client, score] of [
      ['0xC1', 100],
      ['0xC2', 80],
    ] as const) {
      const r = await fetch(`${base}/erc8004/agents/${agentId}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client, score, tag1: 'accuracy' }),
      });
      expect(r.status).toBe(200);
    }
    const rep = (await (await fetch(`${base}/erc8004/agents/${agentId}/reputation`)).json()) as {
      summary: { count: number; averageScore: number };
    };
    expect(rep.summary.count).toBe(2);
    expect(rep.summary.averageScore).toBe(90);
  });

  it('runs a validation request → response', async () => {
    const { agentId } = (await (
      await fetch(`${base}/erc8004/resolve?domain=alice@web3.0`)
    ).json()) as {
      agentId: number;
    };
    const dataHash = '0xfeed';
    const req = await fetch(`${base}/erc8004/validation/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ validator: '0xVAL', agentId, dataHash, uri: 'ipfs://x' }),
    });
    expect(req.status).toBe(200);
    const resp = await fetch(`${base}/erc8004/validation/response`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ validator: '0xVAL', dataHash, value: 95, tag: 'reexecution' }),
    });
    expect(resp.status).toBe(200);
    const rec = (await (await fetch(`${base}/erc8004/validation/${dataHash}`)).json()) as {
      response?: { value: number };
    };
    expect(rec.response?.value).toBe(95);
  });

  it('exposes an ERC-8004 discovery root at /.well-known/erc8004.json', async () => {
    const root = (await (await fetch(`${base}/.well-known/erc8004.json`)).json()) as {
      standard: string;
      registry: string;
      agentCount: number;
    };
    expect(root.standard).toBe('ERC-8004');
    expect(root.registry).toMatch(/^web3:/);
    expect(root.agentCount).toBeGreaterThanOrEqual(1);
  });
});
