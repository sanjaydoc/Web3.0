import { fromB64u, verifyString } from '@web3/crypto';
import { type Block, GENESIS_BLOCK_HASH, hashBlock } from './block.js';

export interface BlockValidation {
  ok: boolean;
  reason?: string;
}

/**
 * A proof-of-authority blockchain over the Web3.0 ledger. A fixed, ordered set of **authorities**
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

  /**
   * @param authorities ordered proposer set (base64url pubkeys)
   * @param slotMs      how long an authority's turn lasts before the next may step in. 0 disables
   *                    skipping (strict round-robin: only round-0 blocks are valid).
   */
  constructor(
    readonly authorities: string[],
    readonly slotMs = 0,
  ) {
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

  /** The authority whose turn it is to propose the block at `height` in the given skip round. */
  expectedProposer(height: number, round = 0): string {
    return this.authorities[(height + round) % this.authorities.length]!;
  }

  /** Validate a block against the current head without applying it. */
  validate(block: Block): BlockValidation {
    if (block.height !== this.height) {
      return { ok: false, reason: `expected height ${this.height}, got ${block.height}` };
    }
    if (block.prevBlockHash !== this.head()) {
      return { ok: false, reason: 'prevBlockHash does not link to the current head' };
    }
    const round = block.round ?? 0;
    if (round < 0 || !Number.isInteger(round)) {
      return { ok: false, reason: 'invalid round' };
    }
    if (block.proposer !== this.expectedProposer(block.height, round)) {
      return {
        ok: false,
        reason: 'proposer is not the authority whose turn it is (for this round)',
      };
    }
    // Skip legitimacy: an out-of-turn proposer (round > 0) must have waited round × slotMs past the
    // previous block, proven by its timestamp — so it can't race ahead of the in-turn authority.
    if (round > 0) {
      if (this.slotMs <= 0) return { ok: false, reason: 'skipping is disabled on this chain' };
      const prev = this._blocks.at(-1);
      const prevMs = prev ? Date.parse(prev.ts) : Number.NaN;
      const blockMs = Date.parse(block.ts);
      if (Number.isNaN(prevMs) || Number.isNaN(blockMs)) {
        return { ok: false, reason: 'round > 0 requires a timestamped predecessor' };
      }
      if (blockMs - prevMs < round * this.slotMs) {
        return { ok: false, reason: 'out-of-turn block is too early for its round' };
      }
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
    const replay = new Blockchain(this.authorities, this.slotMs);
    for (const block of this._blocks) {
      const result = replay.apply(block);
      if (!result.ok) return { ok: false, reason: `block #${block.height}: ${result.reason}` };
    }
    return { ok: true };
  }
}

/**
 * Fork choice: pick the canonical chain from competing candidates. Prefer (1) the longest valid
 * chain, then (2) the one that stayed most in-turn (lowest total skip round — i.e. fewer authorities
 * had to step in), then (3) the lowest head hash. Deterministic, so every honest node converges.
 */
export function heaviest(candidates: Block[][], authorities: string[], slotMs = 0): Block[] {
  let best: Block[] | null = null;
  for (const blocks of candidates) {
    const chain = new Blockchain(authorities, slotMs);
    let valid = true;
    for (const block of blocks) {
      if (!chain.apply(block).ok) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    if (best === null || preferred(blocks, best)) best = blocks;
  }
  return best ?? [];
}

function preferred(a: Block[], b: Block[]): boolean {
  if (a.length !== b.length) return a.length > b.length;
  const ra = totalRounds(a);
  const rb = totalRounds(b);
  if (ra !== rb) return ra < rb;
  return headHash(a) < headHash(b);
}

function totalRounds(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + (b.round ?? 0), 0);
}

function headHash(blocks: Block[]): string {
  return blocks.at(-1)?.hash ?? GENESIS_BLOCK_HASH;
}
