/**
 * @web3/crypto — post-quantum cryptographic primitives for Web3.0.
 *
 * All identity, message integrity, and ledger integrity in Web3.0 rests on NIST-standardized
 * post-quantum algorithms:
 *   - ML-DSA-65 (FIPS 204) for signatures
 *   - ML-KEM-768 (FIPS 203) for confidential data sharing
 *
 * This makes Web3.0 *quantum-resistant*: secure against adversaries with a future quantum
 * computer. It does not make anything "unhackable" — see docs/QUANTUM.md.
 */
export * from './encoding.js';
export * from './keys.js';
export * from './kem.js';
export * from './random.js';
