/**
 * @web3/consensus — a distributed L1 for Web3.0.
 *
 * A proof-of-authority chain layered over the PQC-signed ledger: a fixed set of authorities take
 * turns (round-robin) proposing blocks that batch ledger entries, each block signed with ML-DSA.
 * Validators accept a block only from the authority whose turn it is, linking to the current head,
 * with a valid hash and signature — so independent nodes converge on one canonical chain. Fork
 * choice is longest-valid-chain with a deterministic tie-break.
 *
 * This is an honest MVP of on-chain agreement (not full BFT/PoS); the upgrade path to a
 * byzantine-fault-tolerant validator set is documented in docs/QUANTUM.md.
 */
export * from './block.js';
export * from './chain.js';
export * from './engine.js';
