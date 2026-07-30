import { generateKeypair } from '@web3/crypto';
import {
  priceRequirement,
  privateKeyToAddress,
  randomNonce,
  randomPrivateKey,
  signTransferWithAuthorization,
} from '@web3/x402';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
process.env.WEB3_ADMIN_TOKEN = '';
process.env.WEB3_STORE_MODE_FILE = '/nonexistent/web3-erc8004-earn/store-mode';
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

// The agent's own x402 receiving address (what it binds to its ERC-8004 identity).
const AGENT_WALLET = '0x00000000000000000000000000000000000ea54e';

let kernel: Kernel;
let base: string;

beforeAll(async () => {
  kernel = new Kernel(
    { port: 0, host: '127.0.0.1', x402: X402 },
    generateKeypair(new Uint8Array(32).fill(6)),
    new MemoryStore(),
  );
  await kernel.init();
  base = await kernel.listen();
});
afterAll(async () => {
  await kernel.close();
});

// Pay `AGENT_WALLET` via the node's x402 facilitator, from a fresh payer each time.
async function payAgent() {
  const req = priceRequirement({
    resource: `${base}/some/resource`,
    atomicAmount: '50000',
    payTo: AGENT_WALLET,
    network: 'base-sepolia',
  });
  const priv = randomPrivateKey();
  const authorization = {
    from: privateKeyToAddress(priv),
    to: AGENT_WALLET,
    value: '50000',
    validAfter: '0',
    validBefore: String(Math.floor(Date.now() / 1000) + 60),
    nonce: randomNonce(),
  };
  const signature = await signTransferWithAuthorization(authorization, req, priv);
  const body = {
    x402Version: 1,
    paymentPayload: {
      x402Version: 1,
      scheme: 'exact',
      network: 'base-sepolia',
      payload: { signature, authorization },
    },
    paymentRequirements: req,
  };
  return fetch(`${base}/x402/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('x402 earnings → ERC-8004 economic reputation', () => {
  let agentId: number;

  it('binds an agent to its x402 receiving address', async () => {
    const agent = makeAgent('earner', { name: 'Earner', description: 'sells a skill' });
    expect(
      (
        await fetch(`${base}/agents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(agent.registration),
        })
      ).status,
    ).toBe(201);

    const resolved = (await (
      await fetch(`${base}/erc8004/resolve?domain=earner@web3.0`)
    ).json()) as {
      agentId: number;
    };
    agentId = resolved.agentId;

    const bind = await fetch(`${base}/erc8004/agents/${agentId}/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_WALLET }),
    });
    expect(bind.status).toBe(200);
    // Starts with no economic reputation.
    const rep0 = (await (await fetch(`${base}/erc8004/agents/${agentId}/reputation`)).json()) as {
      combined: { economicScore: number };
    };
    expect(rep0.combined.economicScore).toBe(0);
  });

  it('credits x402 settlements as economic reputation', async () => {
    expect((await payAgent()).status).toBe(200);
    expect((await payAgent()).status).toBe(200);
    expect((await payAgent()).status).toBe(200);

    const rep = (await (await fetch(`${base}/erc8004/agents/${agentId}/reputation`)).json()) as {
      earnings: { paymentCount: number; uniquePayers: number; totalEarnedAtomic: string };
      combined: { economicScore: number; score: number };
    };
    expect(rep.earnings.paymentCount).toBe(3);
    expect(rep.earnings.uniquePayers).toBe(3); // fresh payer each time
    expect(rep.earnings.totalEarnedAtomic).toBe('150000');
    expect(rep.combined.economicScore).toBeGreaterThan(0);
    expect(rep.combined.score).toBe(rep.combined.economicScore); // no feedback yet → economic-only
  });

  it('blends economic with client feedback', async () => {
    await fetch(`${base}/erc8004/agents/${agentId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: '0xReviewer', score: 100, tag1: 'accuracy' }),
    });
    const rep = (await (await fetch(`${base}/erc8004/agents/${agentId}/reputation`)).json()) as {
      combined: { feedbackScore: number; economicScore: number; score: number };
    };
    expect(rep.combined.feedbackScore).toBe(100);
    // 0.6*100 + 0.4*economic → strictly between economic and 100
    expect(rep.combined.score).toBeGreaterThan(rep.combined.economicScore);
    expect(rep.combined.score).toBeLessThanOrEqual(100);
  });

  it('surfaces the reputation snapshot + payment-history trust model in the registration file', async () => {
    const card = (await (await fetch(`${base}/erc8004/agents/${agentId}/card`)).json()) as {
      trustModels: string[];
      reputation?: { economicScore: number; paymentCount: number; totalEarnedAtomic: string };
    };
    expect(card.trustModels).toContain('payment-history');
    expect(card.reputation?.paymentCount).toBe(3);
    expect(card.reputation?.economicScore).toBeGreaterThan(0);
    expect(card.reputation?.totalEarnedAtomic).toBe('150000');
  });
});
