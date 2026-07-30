import { describe, expect, it } from 'vitest';
import {
  LocalFacilitator,
  build402,
  checkPaymentShape,
  decodePaymentHeader,
  jsonToB64,
  priceRequirement,
  privateKeyToAddress,
  randomNonce,
  randomPrivateKey,
  recoverAuthorizationSigner,
  signTransferWithAuthorization,
  verifyExactPayment,
} from '../src/index.js';
import type {
  ExactEvmAuthorization,
  FacilitatorRequest,
  PaymentPayload,
  PaymentRequirements,
} from '../src/index.js';
import { X402_VERSION } from '../src/types.js';

const REQ = (payTo: string): PaymentRequirements =>
  priceRequirement({
    resource: 'https://getpredictiondata.xyz/v1/markets/top',
    atomicAmount: '50000', // 0.05 USDC (6dp)
    payTo,
    network: 'base-sepolia',
  });

function signedPayload(privateKey: string, payTo: string, valueOverride?: string) {
  const req = REQ(payTo);
  const auth: ExactEvmAuthorization = {
    from: privateKeyToAddress(privateKey),
    to: payTo,
    value: valueOverride ?? req.maxAmountRequired,
    validAfter: '0',
    validBefore: String(Math.floor(Date.now() / 1000) + 60),
    nonce: randomNonce(),
  };
  return { req, auth };
}

describe('EIP-3009 exact-scheme signing', () => {
  it('recovers the exact signer address (sign → recover round-trip)', async () => {
    const priv = randomPrivateKey();
    const addr = privateKeyToAddress(priv);
    const { req, auth } = signedPayload(priv, '0x1111111111111111111111111111111111111111');
    const sig = await signTransferWithAuthorization(auth, req, priv);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/); // 65 bytes r||s||v
    expect(recoverAuthorizationSigner(auth, req, sig)?.toLowerCase()).toBe(addr.toLowerCase());
  });

  it('rejects a tampered amount (signature no longer matches from)', async () => {
    const priv = randomPrivateKey();
    const payTo = '0x2222222222222222222222222222222222222222';
    const { req, auth } = signedPayload(priv, payTo);
    const sig = await signTransferWithAuthorization(auth, req, priv);
    // Attacker inflates the value after signing.
    const tampered = { ...auth, value: '99999999' };
    const payload: PaymentPayload = {
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: req.network,
      payload: { signature: sig, authorization: tampered },
    };
    const v = verifyExactPayment(payload, req);
    expect(v.valid).toBe(false);
  });
});

describe('402 header codec + shape checks', () => {
  it('round-trips an X-PAYMENT header', () => {
    const payload: PaymentPayload = {
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: 'base-sepolia',
      payload: {
        signature: `0x${'ab'.repeat(65)}`,
        authorization: {
          from: '0x3333333333333333333333333333333333333333',
          to: '0x4444444444444444444444444444444444444444',
          value: '50000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'11'.repeat(32)}`,
        },
      },
    };
    const header = jsonToB64(payload);
    expect(decodePaymentHeader(header)).toEqual(payload);
  });

  it('flags underpayment and expiry', () => {
    const req = REQ('0x5555555555555555555555555555555555555555');
    const base: PaymentPayload = {
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: 'base-sepolia',
      payload: {
        signature: '0x00',
        authorization: {
          from: '0xaaa',
          to: req.payTo,
          value: '10',
          validAfter: '0',
          validBefore: '100',
          nonce: '0x00',
        },
      },
    };
    expect(checkPaymentShape(base, req, 50).ok).toBe(false); // underpaid
    const ok = {
      ...base,
      payload: {
        ...base.payload,
        authorization: { ...base.payload.authorization, value: '50000' },
      },
    };
    expect(checkPaymentShape(ok, req, 50).ok).toBe(true);
    expect(checkPaymentShape(ok, req, 200).ok).toBe(false); // expired (validBefore 100)
  });
});

describe('LocalFacilitator (node-as-permissionless-facilitator)', () => {
  it('verifies a real signature and settles via the pluggable settleFn', async () => {
    const priv = randomPrivateKey();
    const payTo = '0x6666666666666666666666666666666666666666';
    const { req, auth } = signedPayload(priv, payTo);
    const sig = await signTransferWithAuthorization(auth, req, priv);
    const payload: PaymentPayload = {
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: req.network,
      payload: { signature: sig, authorization: auth },
    };
    const settled: string[] = [];
    const fac = new LocalFacilitator({
      networks: ['base-sepolia'],
      settleFn: async (_r: FacilitatorRequest, payer: string) => {
        settled.push(payer);
        return { success: true, transaction: '0xdeadbeef', network: 'base-sepolia', payer };
      },
    });
    const request: FacilitatorRequest = {
      x402Version: X402_VERSION,
      paymentPayload: payload,
      paymentRequirements: req,
    };
    const verify = await fac.verify(request);
    expect(verify.isValid).toBe(true);
    expect(verify.payer?.toLowerCase()).toBe(privateKeyToAddress(priv).toLowerCase());

    const settle = await fac.settle(request);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBe('0xdeadbeef');
    expect(settled).toHaveLength(1);
  });

  it('refuses to settle an invalid payment', async () => {
    const fac = new LocalFacilitator({
      networks: ['base-sepolia'],
      settleFn: async () => {
        throw new Error('should not be called');
      },
    });
    const req = REQ('0x7777777777777777777777777777777777777777');
    const bad: PaymentPayload = {
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: 'base-sepolia',
      payload: {
        signature: `0x${'00'.repeat(65)}`,
        authorization: {
          from: '0x8888888888888888888888888888888888888888',
          to: req.payTo,
          value: '50000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'22'.repeat(32)}`,
        },
      },
    };
    const settle = await fac.settle({
      x402Version: X402_VERSION,
      paymentPayload: bad,
      paymentRequirements: req,
    });
    expect(settle.success).toBe(false);
  });
});

describe('build402', () => {
  it('wraps requirements in a spec-shaped body', () => {
    const body = build402(REQ('0x9999999999999999999999999999999999999999'), 'pay up');
    expect(body.x402Version).toBe(1);
    expect(body.error).toBe('pay up');
    expect(body.accepts[0]?.scheme).toBe('exact');
  });
});
