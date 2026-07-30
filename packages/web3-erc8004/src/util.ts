import { keccak_256 } from '@noble/hashes/sha3.js';

/** Lowercase an address for map keys / comparison. */
export function normAddr(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Derive a deterministic EVM-shaped address for an agent from stable identity material (its DID or
 * ML-DSA signing public key). This is the "your wallet is your identity" bridge: a Web3.0 agent gets
 * a consistent 20-byte address even before it binds a real EVM wallet. Binding a real wallet later
 * just overrides it.
 */
export function deriveAgentAddress(seed: string): string {
  const hash = keccak_256(new TextEncoder().encode(seed));
  let hex = '0x';
  for (const b of hash.slice(-20)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Build a CAIP-10 account id for a registry contract/address on a chain. */
export function caip10(chainNamespace: string, chainRef: string | number, address: string): string {
  return `${chainNamespace}:${chainRef}:${address}`;
}
