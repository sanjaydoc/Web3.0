/**
 * @acp/ledger — the quantum-resistant, append-only ledger at the core of ACP.
 *
 * Every entry (registration, payment, message provenance) is hash-linked to the previous one
 * and signed by the node authority with ML-DSA. `verifyChain()` proves the whole history is
 * intact; any tampering flips it to a specific `brokenAt` index. Wallet balances are derived
 * from the log, so payments are auditable end-to-end.
 */
export * from './entry.js';
export * from './ledger.js';
