/**
 * x402Fetch — a `fetch` that pays. Call it like `fetch`; if the server answers 402, it reads the
 * payment requirements, signs an EIP-3009 authorization with the wallet, and retries with an
 * `X-PAYMENT` header — all in one call, no accounts, no API keys. This is the client half of the
 * screenshot's `x402-fetch`.
 */

import { jsonToB64 } from './codec.js';
import { b64ToJson } from './codec.js';
import {
  type Hex,
  privateKeyToAddress,
  randomNonce,
  signTransferWithAuthorization,
} from './evm.js';
import type {
  ExactEvmAuthorization,
  PaymentPayload,
  PaymentRequiredResponse,
  PaymentRequirements,
  SettleResponse,
} from './types.js';
import { X402_VERSION } from './types.js';

/** A signer that can authorise `exact`-scheme payments. */
export interface X402Wallet {
  address: string;
  signAuthorization(auth: ExactEvmAuthorization, req: PaymentRequirements): Promise<string>;
}

/** Build a wallet from a raw secp256k1 private key (0x-hex or 32-byte hex). */
export function walletFromPrivateKey(privateKey: Hex): X402Wallet {
  const address = privateKeyToAddress(privateKey);
  return {
    address,
    signAuthorization: (auth, req) => signTransferWithAuthorization(auth, req, privateKey),
  };
}

export interface X402FetchOptions extends RequestInit {
  /** The wallet that pays when a 402 is returned. */
  wallet: X402Wallet;
  /** Which of several offered requirements to pay. Default: the first `exact` one we understand. */
  select?: (accepts: PaymentRequirements[]) => PaymentRequirements | undefined;
  /** Seconds the signed authorization stays valid. Default 60. */
  validForSeconds?: number;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
}

export interface X402FetchResult {
  response: Response;
  /** Whether a payment was made to obtain this response. */
  paid: boolean;
  /** The amount paid, in atomic units (string), when `paid`. */
  amountPaid?: string;
  /** The decoded `X-PAYMENT-RESPONSE`, when the server returned one. */
  settlement?: SettleResponse;
  /** The requirement that was satisfied, when `paid`. */
  requirement?: PaymentRequirements;
}

const defaultSelect = (accepts: PaymentRequirements[]): PaymentRequirements | undefined =>
  accepts.find((a) => a.scheme === 'exact');

/**
 * Perform a request, paying once if the server answers 402. Returns the final response plus payment
 * metadata. Throws only on network errors or an unpayable 402 (no acceptable requirement).
 */
export async function x402Fetch(url: string, opts: X402FetchOptions): Promise<X402FetchResult> {
  const { wallet, select = defaultSelect, validForSeconds = 60, now, ...init } = opts;
  const first = await fetch(url, init);
  if (first.status !== 402) return { response: first, paid: false };

  const body = (await first
    .clone()
    .json()
    .catch(() => null)) as PaymentRequiredResponse | null;
  if (!body?.accepts?.length) {
    throw new Error('x402: server returned 402 with no payment requirements');
  }
  const req = select(body.accepts);
  if (!req) {
    throw new Error(
      `x402: no payable requirement among [${body.accepts.map((a) => `${a.scheme}:${a.network}`).join(', ')}]`,
    );
  }

  const nowSec = Math.floor((now ? now() : Date.now()) / 1000);
  const authorization: ExactEvmAuthorization = {
    from: wallet.address,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: '0',
    validBefore: String(nowSec + validForSeconds),
    nonce: randomNonce(),
  };
  const signature = await wallet.signAuthorization(authorization, req);

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: 'exact',
    network: req.network,
    payload: { signature, authorization },
  };
  const header = jsonToB64(payload);

  const paidHeaders = new Headers(init.headers);
  paidHeaders.set('X-PAYMENT', header);
  const response = await fetch(url, { ...init, headers: paidHeaders });

  const settleHeader = response.headers.get('X-PAYMENT-RESPONSE');
  const settlement = settleHeader
    ? (b64ToJson<SettleResponse>(settleHeader) ?? undefined)
    : undefined;

  return {
    response,
    paid: true,
    amountPaid: req.maxAmountRequired,
    settlement,
    requirement: req,
  };
}
