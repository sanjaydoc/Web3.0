/**
 * @web3/erc8004 — ERC-8004 "Trustless Agents" for Web3.0.
 *
 * Three registries so external agents can discover and trust Web3.0 agents:
 *   • {@link IdentityRegistry}    — agent identity as transferable tokens (agentId → registration file)
 *   • {@link ReputationRegistry}  — bounded feedback attestations (0–100)
 *   • {@link ValidationRegistry}  — independent verification requests + results
 *
 * Ledger-backed, with the same resolution semantics as the on-chain standard and a seam to mirror to
 * real Base contracts. Bridges Web3.0's post-quantum identity (DID + ML-DSA) into the ERC-8004 shape:
 * an agent's wallet address is its identity, and its reputation travels with it.
 */

export * from './types.js';
export { IdentityRegistry, type NewAgentParams } from './identity.js';
export { ReputationRegistry, type GiveFeedbackParams } from './reputation.js';
export { EarningsRegistry, economicScore, combineReputation } from './earnings.js';
export { ValidationRegistry } from './validation.js';
export { buildRegistrationFile, type BuildRegistrationOptions } from './registration-file.js';
export { deriveAgentAddress, normAddr, caip10 } from './util.js';
