import type { Keypair } from '@web3/crypto';
import type { LedgerEntry } from '@web3/ledger';
import { type Block, proposeBlock } from './block.js';
import { type BlockValidation, Blockchain } from './chain.js';

/**
 * A single node's view of the PoA chain. It knows this node's authority identity, so it can propose
 * a block when it's this node's turn, and validate + apply blocks it receives from peers. Feed
 * proposed blocks to peers, and peer blocks back into `receive`, and every honest node converges on
 * the same chain.
 */
export class ConsensusEngine {
  readonly chain: Blockchain;
  private readonly myIndex: number;

  constructor(
    private readonly keys: Keypair,
    readonly publicKeyB64u: string,
    authorities: string[],
    private readonly now: () => string = () => new Date().toISOString(),
    readonly slotMs = 0,
  ) {
    this.chain = new Blockchain(authorities, slotMs);
    this.myIndex = authorities.indexOf(publicKeyB64u);
  }

  get height(): number {
    return this.chain.height;
  }
  head(): string {
    return this.chain.head();
  }
  get blocks(): readonly Block[] {
    return this.chain.blocks;
  }

  /** Is it this node's turn to propose the next block? */
  isMyTurn(): boolean {
    return this.chain.expectedProposer(this.chain.height) === this.publicKeyB64u;
  }

  /**
   * Propose the next block from `entries` if it's this node's turn, applying it locally and
   * returning it to broadcast. Returns null when it's another authority's turn.
   */
  proposeIfMyTurn(entries: LedgerEntry[]): Block | null {
    if (!this.isMyTurn()) return null;
    const block = proposeBlock(
      this.keys,
      this.publicKeyB64u,
      this.chain.height,
      this.chain.head(),
      entries,
      this.now(),
    );
    const result = this.chain.apply(block);
    if (!result.ok) throw new Error(`refused to propose an invalid block: ${result.reason}`);
    return block;
  }

  /**
   * Skip-aware proposal. Given the current wall-clock (ms), work out how many slots have elapsed
   * since the previous block; if enough have passed that it's this node's turn (in-turn, or an
   * out-of-turn round this node owns and no earlier authority produced), propose at that round.
   * This is what lets the chain keep advancing when an authority is offline. `nowMs` is passed in
   * so the caller controls the clock (and tests are deterministic).
   */
  proposeIfDue(entries: LedgerEntry[], nowMs: number): Block | null {
    if (this.myIndex < 0) return null;
    const height = this.chain.height;
    const n = this.chain.authorities.length;
    const myRound = (((this.myIndex - height) % n) + n) % n; // r such that (height + r) % n == me

    if (height === 0) {
      if (myRound !== 0) return null; // genesis is bootstrapped only by the in-turn authority
    } else {
      if (this.slotMs <= 0) {
        if (myRound !== 0) return null; // skipping disabled → in-turn only
      } else {
        const prevMs = Date.parse(this.chain.blocks.at(-1)!.ts);
        const elapsedRounds = Math.floor((nowMs - prevMs) / this.slotMs);
        if (elapsedRounds < myRound) return null; // not this node's turn yet
      }
    }
    return this.propose(entries, myRound, isoFromMs(nowMs, this.now));
  }

  private propose(entries: LedgerEntry[], round: number, ts: string): Block {
    const block = proposeBlock(
      this.keys,
      this.publicKeyB64u,
      this.chain.height,
      this.chain.head(),
      entries,
      ts,
      round,
    );
    const result = this.chain.apply(block);
    if (!result.ok) throw new Error(`refused to propose an invalid block: ${result.reason}`);
    return block;
  }

  /** Validate and apply a block received from a peer. */
  receive(block: Block): BlockValidation {
    return this.chain.apply(block);
  }
}

/** ISO timestamp for a given epoch-ms, falling back to the engine clock if the ms is unusable. */
function isoFromMs(ms: number, fallback: () => string): string {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback();
}
