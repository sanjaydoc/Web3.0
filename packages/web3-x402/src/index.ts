/**
 * @web3/x402 — internet-native payments for Web3.0 agents.
 *
 * Implements the x402 "HTTP 402 Payment Required" standard so a Web3.0 node and its agents
 * interoperate with the wider agent-payments ecosystem (the official `x402-fetch` client, OpenX402
 * and CDP facilitators). The `exact` scheme is a stablecoin (USDC) transfer authorized off-chain
 * with an EIP-3009 signature; settlement is pluggable — a local Web3.0 ledger by default, or a real
 * chain via a facilitator.
 */

export * from './types.js';
export { jsonToB64, b64ToJson } from './codec.js';
export {
  build402,
  priceRequirement,
  decodePaymentHeader,
  encodeSettleResponse,
  checkPaymentShape,
  BASE_SEPOLIA_USDC,
  type PriceOptions,
} from './server.js';
export {
  x402Fetch,
  walletFromPrivateKey,
  type X402Wallet,
  type X402FetchOptions,
  type X402FetchResult,
} from './client.js';
export {
  LocalFacilitator,
  HttpFacilitator,
  type Facilitator,
  type SettleFn,
  type LocalFacilitatorOptions,
} from './facilitator.js';
export {
  signTransferWithAuthorization,
  recoverAuthorizationSigner,
  verifyExactPayment,
  transferDigest,
  privateKeyToAddress,
  randomPrivateKey,
  randomNonce,
  chainIdFor,
  type Hex,
} from './evm.js';
