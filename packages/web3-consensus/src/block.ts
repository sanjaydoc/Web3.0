import { hashJson, signString } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import type { LedgerEntry } from '@web3/ledger';

/** The hash a genesis block links back to. */
export const GENESIS_BLOCK_HASH = '0'.repeat(64);

/** The fields covered by a block's hash (and therefore by the proposer's signature). */
export interface BlockCore {
  /** 0-based position in the chain. */
  height: number;
  /** Hash of the previous block (GENESIS_BLOCK_HASH at height 0). */
  prevBlockHash: string;
  /** base64url ML-DSA public key of the authority that proposed this block. */
  proposer: string;
  /**
   * Skip round. 0 = the in-turn authority (`authorities[height % n]`). A higher round means an
   * out-of-turn authority stepped in because earlier ones didn't produce in time — legitimacy is
   * proven by `ts` advancing at least `round × slotMs` past the previous block. This is what keeps
   * the chain live when an authority is offline.
   */
  round: number;
  /** The ledger entries batched into this block, in order. */
  entries: LedgerEntry[];
  /** ISO-8601 proposal time. */
  ts: string;
}

/** A proposed, signed block. `signature` is the proposer's ML-DSA signature over `hash`. */
export interface Block extends BlockCore {
  hash: string;
  signature: string;
}

/** Canonical hash of a block's core fields — identical across nodes and languages. */
export function hashBlock(core: BlockCore): string {
  return hashJson({
    height: core.height,
    prevBlockHash: core.prevBlockHash,
    proposer: core.proposer,
    round: core.round,
    entries: core.entries,
    ts: core.ts,
  });
}

/**
 * Propose (and sign) a block. The proposer must be the authority whose turn it is at `height`
 * (see `expectedProposer`), but that policy is enforced on apply — this just builds the artifact.
 */
export function proposeBlock(
  keys: Keypair,
  proposerPublicKeyB64u: string,
  height: number,
  prevBlockHash: string,
  entries: LedgerEntry[],
  now: string,
  round = 0,
): Block {
  const core: BlockCore = {
    height,
    prevBlockHash,
    proposer: proposerPublicKeyB64u,
    round,
    entries,
    ts: now,
  };
  const hash = hashBlock(core);
  return { ...core, hash, signature: signString(keys.secretKey, hash) };
}
