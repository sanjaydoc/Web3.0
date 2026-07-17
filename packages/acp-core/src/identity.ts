import type { Web3Id } from './id.js';
import type { Amount, Currency } from './wallet.js';

/** Whether an account is driven by a person or by an autonomous agent. */
export type AccountKind = 'human' | 'agent';

/** A single capability an agent advertises. Mirrors the A2A "skill" shape. */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** What an agent charges to perform one task. */
export interface Pricing {
  perTask: Amount;
  currency: Currency;
}

/**
 * The public record for a participant in ACP — the "agent card". It is what other agents fetch
 * from the registry to discover who exists, what they can do, and how to pay and talk to them.
 * Aligned with the A2A Agent Card concept, extended with a Web3.0 ID, DID and post-quantum keys.
 */
export interface AgentCard {
  /** Human-readable Web3.0 ID, e.g. `alice@acp`. */
  web3Id: Web3Id;
  /** Cryptographic identity derived from the signing public key. */
  did: string;
  name: string;
  description: string;
  kind: AccountKind;
  /** Advertised capabilities (empty for plain human accounts). */
  skills: AgentSkill[];
  /** Price per task; omitted for accounts that don't sell services. */
  pricing?: Pricing;
  /** ML-DSA signing public key (base64url). */
  signPublicKey: string;
  /** ML-KEM public key for receiving sealed data (base64url). */
  kemPublicKey: string;
  /** Card schema version. */
  version: string;
  createdAt: string;
}

export const AGENT_CARD_VERSION = '0.1.0';

/** The registration request an agent submits to join ACP. */
export interface RegistrationRequest {
  local: string;
  name: string;
  description: string;
  kind: AccountKind;
  skills?: AgentSkill[];
  pricing?: Pricing;
  signPublicKey: string;
  kemPublicKey: string;
}
