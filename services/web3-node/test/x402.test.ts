import { generateKeypair } from '@web3/crypto';
import { randomPrivateKey, walletFromPrivateKey, x402Fetch } from '@web3/x402';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
process.env.WEB3_ADMIN_TOKEN = '';
process.env.WEB3_STORE_MODE_FILE = '/nonexistent/web3-x402/store-mode';
import { Kernel } from '../src/kernel.js';
import { MemoryStore } from '../src/store/index.js';

const SEED = new Uint8Array(32).fill(4);
const PAY_TO = '0x000000000000000000000000000000000000dEaD';
// Pass x402 config via the Kernel override (env is read at import-time, which ESM hoists before
// this file's top-level assignments run — so overrides, not env, are the reliable path in tests).
const X402 = {
  enabled: true,
  network: 'base-sepolia',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  payTo: PAY_TO,
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
    generateKeypair(SEED),
    new MemoryStore(),
  );
  await kernel.init();
  base = await kernel.listen();
});

afterAll(async () => {
  await kernel.close();
});

describe('node x402 module', () => {
  it('advertises the exact scheme on /x402/supported', async () => {
    const s = (await (await fetch(`${base}/x402/supported`)).json()) as {
      kinds: Array<{ scheme: string; network: string }>;
    };
    expect(s.kinds[0]?.scheme).toBe('exact');
  });

  it('returns a spec-shaped 402 to an unpaid resource request', async () => {
    const res = await fetch(`${base}/x402/demo/markets/top`);
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      x402Version: number;
      accepts: Array<{ scheme: string; payTo: string; maxAmountRequired: string }>;
    };
    expect(body.x402Version).toBe(1);
    expect(body.accepts[0]?.scheme).toBe('exact');
    expect(body.accepts[0]?.payTo).toBe(PAY_TO);
    expect(body.accepts[0]?.maxAmountRequired).toBe('50000');
  });

  it('pays with x402Fetch and gets the resource (real EIP-3009 signature)', async () => {
    const wallet = walletFromPrivateKey(randomPrivateKey());
    const { response, paid, amountPaid, settlement } = await x402Fetch(
      `${base}/x402/demo/markets/top`,
      { wallet },
    );
    expect(paid).toBe(true);
    expect(amountPaid).toBe('50000');
    expect(response.status).toBe(200);
    expect(settlement?.success).toBe(true);
    expect(settlement?.payer?.toLowerCase()).toBe(wallet.address.toLowerCase());
    const data = (await response.json()) as { markets: unknown[] };
    expect(data.markets).toHaveLength(3);
  });

  it('records a receipt the operator console can read', async () => {
    const r = (await (await fetch(`${base}/x402/receipts`)).json()) as { receipts: unknown[] };
    expect(r.receipts.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a forged signature at /x402/verify', async () => {
    const req = {
      x402Version: 1,
      paymentPayload: {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        payload: {
          signature: `0x${'00'.repeat(65)}`,
          authorization: {
            from: '0x1111111111111111111111111111111111111111',
            to: PAY_TO,
            value: '50000',
            validAfter: '0',
            validBefore: '9999999999',
            nonce: `0x${'aa'.repeat(32)}`,
          },
        },
      },
      paymentRequirements: {
        scheme: 'exact',
        network: 'base-sepolia',
        maxAmountRequired: '50000',
        resource: `${base}/x402/demo/markets/top`,
        description: 'x',
        mimeType: 'application/json',
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        extra: { name: 'USDC', version: '2' },
      },
    };
    const v = (await (
      await fetch(`${base}/x402/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      })
    ).json()) as { isValid: boolean };
    expect(v.isValid).toBe(false);
  });
});
