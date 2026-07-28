/**
 * @web3/core — the shared protocol vocabulary of Web3.0.
 *
 * Everything the kernel and its modules exchange is defined here: Web3.0 IDs, agent cards,
 * wallets, signed envelopes, the A2A-aligned task lifecycle, and observability events. Keeping
 * these types in one dependency-light package lets every module (and the Python SDK's mirror)
 * speak the same language.
 */
export * from './id.js';
export * from './wallet.js';
export * from './identity.js';
export * from './envelope.js';
export * from './messages.js';
export * from './events.js';
export * from './transaction.js';
