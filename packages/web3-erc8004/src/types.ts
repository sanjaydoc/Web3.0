/**
 * ERC-8004 "Trustless Agents" types — three registries that give an agent a verifiable identity, a
 * portable reputation, and independent validation, extending A2A's Agent Card.
 *
 *   • Identity   — an ERC-721-style registry: each agent is a transferable token (agentId) that
 *                  resolves to a registration file (the Agent Card).
 *   • Reputation — bounded feedback attestations (score 0–100) clients publish about an agent.
 *   • Validation — verification requests and validator responses, keyed by a data hash.
 *
 * This is the ledger-backed model: the same shapes and resolution semantics as the on-chain
 * standard, recorded on the Web3.0 PQC ledger, with a seam to mirror to real Base contracts.
 */

/** Bounded reputation score range (inclusive), per the standard. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** A CAIP-10 account id, e.g. `eip155:8453:0x…` — how a registration points at its registry. */
export type Caip10 = string;

/** Trust models an agent advertises it supports (how a counterparty can gain confidence). */
export type TrustModel = 'feedback' | 'inference-validation' | 'tee-attestation' | (string & {});

/** One agent's identity record — the ERC-721 token's backing data. */
export interface AgentRegistration {
  /** The ERC-721 tokenId. Monotonic, assigned at registration. */
  agentId: number;
  /** The controlling address (owner of the NFT). Transferring it hands over the agent. */
  owner: string;
  /** The agent's address — equals `owner` unless separately delegated. */
  agentAddress: string;
  /** The agent's domain / handle, e.g. `alice@web3.0`. Unique within a registry. */
  agentDomain: string;
  /** Bridge: the Web3.0 ID this identity corresponds to. */
  web3Id?: string;
  /** Bridge: the post-quantum DID (ML-DSA) — Web3.0's canonical identity. */
  did?: string;
  /** URI of the registration file (the Agent Card), i.e. ERC-721 `tokenURI`. */
  tokenURI: string;
  createdAt: string;
  updatedAt: string;
}

/** A single bounded feedback attestation about an agent. */
export interface Feedback {
  /** Index within the agent's feedback list (its id). */
  index: number;
  agentId: number;
  /** Address that left the feedback. */
  client: string;
  /** Bounded score, 0–100. */
  score: number;
  /** Optional short tags for categorising feedback (e.g. `speed`, `accuracy`). */
  tag1?: string;
  tag2?: string;
  /** Optional URI to off-chain detail (a review, a transcript). */
  uri?: string;
  /** Optional hash binding the off-chain detail. */
  fileHash?: string;
  ts: string;
  /** Set when the client revokes this feedback. */
  revoked?: boolean;
  /** The agent owner's public response to this feedback, if any. */
  response?: string;
}

/** Aggregate reputation for an agent, computed from its non-revoked feedback. */
export interface FeedbackSummary {
  agentId: number;
  count: number;
  /** Mean score across non-revoked feedback, 0–100 (0 when there is none). */
  averageScore: number;
  lastScore?: number;
  /** Per-tag breakdown. */
  byTag: Record<string, { count: number; average: number }>;
}

/** A validation request/response record, keyed by the hash of the work being validated. */
export interface ValidationRecord {
  dataHash: string;
  /** The validator asked to verify the work. */
  validator: string;
  agentId: number;
  /** Optional URI to the work / request detail. */
  uri?: string;
  requestedAt: string;
  /** Filled in when the validator responds. */
  response?: {
    /** Result, 0–100 (0 = rejected, 100 = fully valid). */
    value: number;
    uri?: string;
    tag?: string;
    respondedAt: string;
  };
}

/** One payment an agent received — an economic-reputation signal drawn from x402 settlements. */
export interface EarningRecord {
  agentId: number;
  /** Amount received, in the asset's atomic units, as a decimal string. */
  amountAtomic: string;
  asset: string;
  /** Who paid (their address). */
  payer: string;
  /** The settlement transaction reference. */
  tx?: string;
  ts: string;
}

/** Aggregate earnings for an agent — "proof of demand" that feeds economic reputation. */
export interface EarningsSummary {
  agentId: number;
  /** Total received across all recorded payments, atomic units, as a decimal string. */
  totalEarnedAtomic: string;
  paymentCount: number;
  /** Number of distinct payers — repeat/diverse demand is a stronger signal than volume alone. */
  uniquePayers: number;
  lastPaidAt?: string;
  /**
   * A bounded 0–100 economic-reputation score derived from payment count + payer diversity (not the
   * raw amount, which varies by asset/decimals). Monotonic: more payments from more distinct payers
   * → higher score. A heuristic "this agent has real, recurring demand" signal.
   */
  economicScore: number;
}

/** A combined reputation view: feedback + economic, and a blended score. */
export interface CombinedReputation {
  agentId: number;
  feedbackScore: number;
  feedbackCount: number;
  economicScore: number;
  paymentCount: number;
  /** Blend of feedback and economic scores (0–100). */
  score: number;
}

/** The ERC-8004 registration file (A2A Agent Card + on-chain registration pointers + trust models). */
export interface RegistrationFile {
  /** A2A-aligned fields. */
  name: string;
  description: string;
  /** The agent's service URL(s) — A2A. */
  url?: string;
  version: string;
  skills?: unknown[];
  /** ERC-8004: where this identity is registered and proof it controls it. */
  registrations: Array<{ agentId: number; agentRegistry: Caip10; agentAddress: string }>;
  /** ERC-8004: how counterparties can trust this agent. */
  trustModels: TrustModel[];
  /** Web3.0 bridge: post-quantum identity material. */
  web3?: { web3Id?: string; did?: string; signPublicKey?: string };
  /** Live reputation snapshot — feedback + economic (x402 earnings) + blended score. */
  reputation?: {
    score: number;
    feedbackScore: number;
    feedbackCount: number;
    economicScore: number;
    paymentCount: number;
    totalEarnedAtomic: string;
  };
}

/** Events the registries emit (mirrored to the Web3.0 event bus + ledger). */
export type Erc8004Event =
  | { kind: 'identity.registered'; agentId: number; agentAddress: string; agentDomain: string }
  | { kind: 'identity.transferred'; agentId: number; from: string; to: string }
  | { kind: 'reputation.feedback'; agentId: number; client: string; score: number }
  | { kind: 'reputation.earning'; agentId: number; payer: string; amountAtomic: string }
  | { kind: 'validation.requested'; agentId: number; validator: string; dataHash: string }
  | { kind: 'validation.responded'; agentId: number; dataHash: string; value: number };
