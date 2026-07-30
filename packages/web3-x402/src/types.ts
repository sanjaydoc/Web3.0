/**
 * x402 wire types — the "HTTP 402 Payment Required" internet-native payment standard.
 *
 * These match the x402 v1 spec (the shape the official `x402-fetch` client and OpenX402 / CDP
 * facilitators speak), so a Web3.0 node interoperates with the wider agent-payments ecosystem
 * rather than a private dialect. The canonical scheme here is `exact` on an EVM network, settled in
 * a stablecoin (USDC) via an EIP-3009 `transferWithAuthorization` the buyer signs off-chain.
 */

export const X402_VERSION = 1 as const;

/** Where a payment settles. Free-form on the wire; these are the ones we build against. */
export type Network = 'base' | 'base-sepolia' | 'web3-ledger' | (string & {});

/**
 * One acceptable way to pay for a resource, advertised inside a 402 response's `accepts` array.
 * A client picks one it can satisfy, pays it, and retries with an `X-PAYMENT` header.
 */
export interface PaymentRequirements {
  /** Payment scheme. `exact` = pay an exact amount (the only scheme x402 v1 standardises). */
  scheme: 'exact';
  network: Network;
  /** Maximum amount required, in the asset's atomic units, as a decimal string (e.g. USDC 6dp). */
  maxAmountRequired: string;
  /** The resource being paid for (its absolute URL). */
  resource: string;
  /** Human-readable description of what the payment buys. */
  description: string;
  /** MIME type of the resource the client gets back on success. */
  mimeType: string;
  /** Optional JSON schema describing the response body. */
  outputSchema?: unknown;
  /** The address that receives the payment. */
  payTo: string;
  /** How long the server will wait for settlement before giving up. */
  maxTimeoutSeconds: number;
  /** The token contract to pay in (an ERC-20, typically USDC). */
  asset: string;
  /** Scheme-specific extras. For `exact`/EIP-3009: the EIP-712 domain `{ name, version }`. */
  extra?: { name?: string; version?: string } & Record<string, unknown>;
}

/** The body a server returns with HTTP 402. */
export interface PaymentRequiredResponse {
  x402Version: typeof X402_VERSION;
  /** Why payment is required / what went wrong with a prior attempt. */
  error?: string;
  accepts: PaymentRequirements[];
}

/** An EIP-3009 `transferWithAuthorization` authorization — the thing the buyer signs. */
export interface ExactEvmAuthorization {
  from: string;
  to: string;
  /** Value in the asset's atomic units, as a decimal string. */
  value: string;
  /** Unix seconds; the authorization is invalid before this. */
  validAfter: string;
  /** Unix seconds; the authorization is invalid at/after this. */
  validBefore: string;
  /** 32-byte random nonce, 0x-hex — single-use, prevents replay. */
  nonce: string;
}

/** The `exact`-scheme payload: a signed EIP-3009 authorization. */
export interface ExactEvmPayload {
  /** 65-byte secp256k1 signature over the EIP-712 typed data, 0x-hex. */
  signature: string;
  authorization: ExactEvmAuthorization;
}

/** The decoded contents of an `X-PAYMENT` header. */
export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  scheme: 'exact';
  network: Network;
  payload: ExactEvmPayload;
}

/** Facilitator `/verify` result. */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  /** The recovered payer address, when the signature checks out. */
  payer?: string;
}

/** Facilitator `/settle` result, mirrored back to the client in `X-PAYMENT-RESPONSE`. */
export interface SettleResponse {
  success: boolean;
  /** On-chain (or ledger) transaction reference. */
  transaction: string;
  network: Network;
  payer?: string;
  errorReason?: string;
  /** Block-explorer link, when the rail provides one. */
  explorerUrl?: string;
}

/** Facilitator `/supported` result — the scheme/network pairs it can settle. */
export interface SupportedKinds {
  kinds: Array<{ x402Version: number; scheme: string; network: Network }>;
}

/** The request body both facilitator endpoints (`/verify`, `/settle`) take. */
export interface FacilitatorRequest {
  x402Version: typeof X402_VERSION;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}
