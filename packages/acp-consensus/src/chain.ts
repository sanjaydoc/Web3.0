import { fromB64u, verifyString } from '@acp/crypto';
import { type Block, GENESIS_BLOCK_HASH, hashBlock } from './block.js';

export interface BlockValidation {
  ok: boolean;
  reason?: string;
}

/**
 * A proof-of-authority blockchain over the ACP ledger. A fixed, ordered set of **authorities**
 * (their ML-DSA public keys) take turns proposing blocks in round-robin order: the proposer for a
 * block at `height` is `authorities[height % authorities.length]`. Every block is signed by that
 * authority, so validators accept a block only if it came from the right authority, in turn, links
 * to the current head, and its hash/signature check out.
 *
 * This is an honest MVP of a distributed L1: real multi-node agreement with cryptographic block
 * production, not a full BFT/PoS protocol. Fork choice is longest-valid-chain (see `heaviest`).
 */
export class Blockchain {
  private readonly _blocks: Block[] = [];

  constructor(readonly authorities: string[]) {
    if (authorities.length === 0) throw new Error('a PoA chain needs at least one authority');
  }

  get blocks(): readonly Block[] {
    return this._blocks;
  }
  get height(): number {
    return this._blocks.length;
  }
  head(): string {
    return this._blocks.at(-1)?.hash ?? GENESIS_BLOCK_HASH;
  }

  /** The authority whose turn it is to propose the block at `height`. */
  expectedProposer(height: number): string {
    return this.authorities[height % this.authorities.length]!;
  }

  /** Validate a block against the current head without applying it. */
  validate(block: Block): BlockValidation {
    if (block.height !== this.height) {
      return { ok: false, reason: `expected height ${this.height}, got ${block.height}` };
    }
    if (block.prevBlockHash !== this.head()) {
      return { ok: false, reason: 'prevBlockHash does not link to the current head' };
    }
    const proposer = this.expectedProposer(block.height);
    if (block.proposer !== proposer) {
      return { ok: false, reason: 'proposer is not the authority whose turn it is' };
    }
    if (hashBlock(block) !== block.hash) {
      return { ok: false, reason: 'block hash mismatch (tampered content)' };
    }
    if (!verifyString(fromB64u(block.proposer), block.hash, block.signature)) {
      return { ok: false, reason: 'invalid proposer signature' };
    }
    return { ok: true };
  }

  /** Validate and append a block. Returns the validation result; only appends when valid. */
  apply(block: Block): BlockValidation {
    const result = this.validate(block);
    if (result.ok) this._blocks.push(block);
    return result;
  }

  /** Re-validate the whole chain from genesis (what an auditor / a syncing node runs). */
  verifyChain(): BlockValidation {
    const replay = new Blockchain(this.authorities);
    for (const block of this._blocks) {
      const result = replay.apply(block);
      if (!result.ok) return { ok: false, reason: `block #${block.height}: ${result.reason}` };
    }
    return { ok: true };
  }
}

/**
 * Fork choice: pick the canonical chain from competing candidates — the longest valid one, with a
 * deterministic tie-break on the head hash so every honest node converges on the same choice.
 * Each candidate is the ordered block list of a competing view; `authorities` is the shared set.
 */
export function heaviest(candidates: Block[][], authorities: string[]): Block[] {
  let best: Block[] = [];
  for (const blocks of candidates) {
    const chain = new Blockchain(authorities);
    let valid = true;
    for (const block of blocks) {
      if (!chain.apply(block).ok) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    if (
      blocks.length > best.length ||
      (blocks.length === best.length && headHash(blocks) < headHash(best))
    ) {
      best = blocks;
    }
  }
  return best;
}

function headHash(blocks: Block[]): string {
  return blocks.at(-1)?.hash ?? GENESIS_BLOCK_HASH;
}
