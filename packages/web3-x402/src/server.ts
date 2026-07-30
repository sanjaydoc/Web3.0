/**
 * Server-side x402 helpers: price a resource (build the 402 body), decode/validate the client's
 * `X-PAYMENT` header, and encode the `X-PAYMENT-RESPONSE` receipt. These are framework-agnostic —
 * the Web3.0 node's x402 module wires them into Fastify, but they work anywhere.
 */

import { b64ToJson, jsonToB64 } from './codec.js';
import type {
  PaymentPayload,
  PaymentRequiredResponse,
  PaymentRequirements,
  SettleResponse,
} from './types.js';
import { X402_VERSION } from './types.js';

/** Well-known testnet USDC (Base Sepolia) — the default asset for demos on a real chain. */
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export interface PriceOptions {
  /** Absolute URL of the resource being priced. */
  resource: string;
  /** Amount required in the asset's atomic units, as a decimal string (USDC has 6 decimals). */
  atomicAmount: string;
  /** Address that receives the payment. */
  payTo: string;
  network?: PaymentRequirements['network'];
  asset?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  /** EIP-712 domain for the asset (USDC on Base is name "USDC", version "2"). */
  domain?: { name: string; version: string };
  outputSchema?: unknown;
}

/** Build a single `exact`-scheme payment requirement. */
export function priceRequirement(opts: PriceOptions): PaymentRequirements {
  const network = opts.network ?? 'base-sepolia';
  return {
    scheme: 'exact',
    network,
    maxAmountRequired: opts.atomicAmount,
    resource: opts.resource,
    description: opts.description ?? `Payment required to access ${opts.resource}`,
    mimeType: opts.mimeType ?? 'application/json',
    ...(opts.outputSchema !== undefined ? { outputSchema: opts.outputSchema } : {}),
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 60,
    asset: opts.asset ?? BASE_SEPOLIA_USDC,
    extra: opts.domain ?? { name: 'USDC', version: '2' },
  };
}

/** Build the full HTTP 402 response body from one or more requirements. */
export function build402(
  accepts: PaymentRequirements | PaymentRequirements[],
  error?: string,
): PaymentRequiredResponse {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    accepts: Array.isArray(accepts) ? accepts : [accepts],
  };
}

/** Decode the base64 `X-PAYMENT` header into a payment payload. Returns null if it can't parse. */
export function decodePaymentHeader(header: string | undefined | null): PaymentPayload | null {
  if (!header) return null;
  const decoded = b64ToJson<PaymentPayload>(header);
  if (!decoded || decoded.x402Version !== X402_VERSION || decoded.scheme !== 'exact') return null;
  if (!decoded.payload?.authorization || !decoded.payload?.signature) return null;
  return decoded;
}

/** Encode a settlement result for the `X-PAYMENT-RESPONSE` header. */
export function encodeSettleResponse(res: SettleResponse): string {
  return jsonToB64(res);
}

/**
 * Structural checks that don't need crypto: does the payload target the same asset/network as the
 * requirement, is the amount at least what's required, and is the authorization currently valid?
 * (Signature recovery lives in evm.ts / the facilitator.) `nowSec` is injectable for tests.
 */
export function checkPaymentShape(
  payload: PaymentPayload,
  req: PaymentRequirements,
  nowSec: number = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; reason: string } {
  if (payload.network !== req.network) {
    return { ok: false, reason: `network mismatch: paid ${payload.network}, need ${req.network}` };
  }
  const a = payload.payload.authorization;
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) {
    return { ok: false, reason: `wrong payTo: ${a.to} != ${req.payTo}` };
  }
  let value: bigint;
  let required: bigint;
  try {
    value = BigInt(a.value);
    required = BigInt(req.maxAmountRequired);
  } catch {
    return { ok: false, reason: 'non-integer amount' };
  }
  if (value < required) {
    return { ok: false, reason: `underpaid: ${value} < ${required}` };
  }
  if (Number(a.validAfter) > nowSec) return { ok: false, reason: 'authorization not yet valid' };
  if (Number(a.validBefore) <= nowSec) return { ok: false, reason: 'authorization expired' };
  return { ok: true };
}
