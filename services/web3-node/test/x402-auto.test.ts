import { generateKeypair } from '@web3/crypto';
import { deriveAgentAddress } from '@web3/erc8004';
import { randomPrivateKey, walletFromPrivateKey, x402Fetch } from '@web3/x402';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
process.env.WEB3_ADMIN_TOKEN = '';
process.env.WEB3_STORE_MODE_FILE = '/nonexistent/web3-x402-auto/store-mode';
import { Kernel } from '../src/kernel.js';
import { MemoryStore } from '../src/store/index.js';
import { makeAgent } from '../src/testkit.js';

const X402 = {
  enabled: true,
  network: 'base-sepolia',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  payTo: '0x000000000000000000000000000000000000dEaD',
  domainName: 'USDC',
  domainVersion: '2',
  demoPriceAtomic: '50000',
  settle: 'ledger' as const,
};

let kernel: Kernel;
let base: string;

beforeAll(async () => {
  kernel = new Kernel(
    { port: 0, host: '127.0.0.1', x402: X402 },
    generateKeypair(new Uint8Array(32).fill(8)),
    new MemoryStore(),
  );
  await kernel.init();
  base = await kernel.listen();
  // A priced agent — perTask 500 minor (= $5.00), one skill.
  const agent = makeAgent('seller', {
    name: 'Seller',
    description: 'sells a summarise skill',
    skills: [{ id: 'summarise', name: 'Summarise', description: 'summarise text', tags: ['nlp'] }],
    pricing: { perTask: 500, currency: 'aETH' },
  });
  const res = await fetch(`${base}/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(agent.registration),
  });
  if (res.status !== 201) throw new Error(`register failed ${res.status}`);
});
afterAll(async () => {
  await kernel.close();
});

describe('auto-priced agent skills (x402 out of the box)', () => {
  it('lists the priced skill in the x402 directory', async () => {
    const dir = (await (await fetch(`${base}/x402/directory`)).json()) as {
      count: number;
      services: {
        web3Id: string;
        skillId: string;
        priceAtomic: string;
        priceUsd: string;
        payTo: string;
        endpoint: string;
      }[];
    };
    expect(dir.count).toBe(1);
    const svc = dir.services[0];
    expect(svc?.web3Id).toBe('seller@web3.0');
    expect(svc?.skillId).toBe('summarise');
    expect(svc?.priceAtomic).toBe('5000000'); // $5.00 in USDC 6dp
    expect(svc?.priceUsd).toBe('5.00');
    expect(svc?.endpoint).toBe('/x402/call/seller@web3.0/summarise');
  });

  it('auto-binds the receiving wallet to the agent’s derived ERC-8004 address', async () => {
    const resolved = (await (
      await fetch(`${base}/erc8004/resolve?domain=seller@web3.0`)
    ).json()) as { did: string; agentAddress: string };
    const dir = (await (await fetch(`${base}/x402/directory`)).json()) as {
      services: { payTo: string }[];
    };
    // The x402 payTo equals the address ERC-8004 derived for this agent — no manual bind.
    expect(dir.services[0]?.payTo).toBe(deriveAgentAddress(resolved.did));
    expect(dir.services[0]?.payTo).toBe(resolved.agentAddress);
  });

  it('returns 402 to an unpaid call, priced per the agent’s rate', async () => {
    const res = await fetch(`${base}/x402/call/seller@web3.0/summarise`);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { accepts: { maxAmountRequired: string; payTo: string }[] };
    expect(body.accepts[0]?.maxAmountRequired).toBe('5000000');
  });

  it('pays the agent and settles (delivery pending — no brain attached in test)', async () => {
    const wallet = walletFromPrivateKey(randomPrivateKey());
    const { response, paid, amountPaid, settlement } = await x402Fetch(
      `${base}/x402/call/seller@web3.0/summarise?q=hello`,
      { wallet },
    );
    expect(paid).toBe(true);
    expect(amountPaid).toBe('5000000');
    expect(response.status).toBe(200);
    expect(settlement?.success).toBe(true);
    const body = (await response.json()) as {
      agent: string;
      skill: string;
      delivery: string;
      taskId: string;
    };
    expect(body.agent).toBe('seller@web3.0');
    expect(body.skill).toBe('summarise');
    expect(['completed', 'pending', 'queued']).toContain(body.delivery);
    expect(body.taskId).toMatch(/^x402_/);
  });

  it('credits the payment to the agent’s ERC-8004 economic reputation', async () => {
    const { agentId } = (await (
      await fetch(`${base}/erc8004/resolve?domain=seller@web3.0`)
    ).json()) as { agentId: number };
    const rep = (await (await fetch(`${base}/erc8004/agents/${agentId}/reputation`)).json()) as {
      earnings: { paymentCount: number; totalEarnedAtomic: string };
      combined: { economicScore: number };
    };
    expect(rep.earnings.paymentCount).toBeGreaterThanOrEqual(1);
    expect(rep.earnings.totalEarnedAtomic).toBe('5000000');
    expect(rep.combined.economicScore).toBeGreaterThan(0);
  });
});
