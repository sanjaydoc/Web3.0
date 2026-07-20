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
  /** Membership changes queued by governance, carried in the next block this node proposes. */
  private readonly pendingAuthorityAdds: string[] = [];
  private readonly pendingAuthorityRemoves: string[] = [];

  constructor(
    private readonly keys: Keypair,
    readonly publicKeyB64u: string,
    authorities: string[],
    private readonly now: () => string = () => new Date().toISOString(),
    readonly slotMs = 0,
  ) {
    this.chain = new Blockchain(authorities, slotMs);
  }

  /** This node's position in the LIVE authority set (-1 = not an authority right now). */
  private get myIndex(): number {
    return this.chain.authorities.indexOf(this.publicKeyB64u);
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
   * Queue an authority key to be seated on-chain: the next block this node proposes carries it as
   * `authorityAdd`, and every node applies the membership change when that block lands. Ignored if
   * the key is already an authority or already queued.
   */
  queueAuthorityAdd(key: string): void {
    const k = key.trim();
    if (!k || this.chain.authorities.includes(k) || this.pendingAuthorityAdds.includes(k)) return;
    this.pendingAuthorityAdds.push(k);
  }

  /** Queue an authority key for on-chain REMOVAL (voluntary exit or slash). */
  queueAuthorityRemove(key: string): void {
    const k = key.trim();
    if (!k || !this.chain.authorities.includes(k) || this.pendingAuthorityRemoves.includes(k))
      return;
    this.pendingAuthorityRemoves.push(k);
  }

  /** The next queued removal that is still valid (key still seated, set stays non-empty). */
  private nextAuthorityRemove(): string | undefined {
    while (this.pendingAuthorityRemoves.length > 0) {
      const k = this.pendingAuthorityRemoves[0]!;
      if (this.chain.authorities.includes(k) && this.chain.authorities.length > 1) return k;
      this.pendingAuthorityRemoves.shift(); // already gone (or would empty the set)
    }
    return undefined;
  }

  /** The next queued membership change that is still valid to seat. */
  private nextAuthorityAdd(): string | undefined {
    while (this.pendingAuthorityAdds.length > 0) {
      const k = this.pendingAuthorityAdds[0]!;
      if (!this.chain.authorities.includes(k)) return k;
      this.pendingAuthorityAdds.shift(); // someone else already seated it
    }
    return undefined;
  }

  /**
   * Propose the next block from `entries` if it's this node's turn, applying it locally and
   * returning it to broadcast. Returns null when it's another authority's turn.
   */
  proposeIfMyTurn(entries: LedgerEntry[]): Block | null {
    if (!this.isMyTurn()) return null;
    return this.propose(entries, 0, this.now());
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
    const authorityAdd = this.nextAuthorityAdd();
    const authorityRemove = this.nextAuthorityRemove();
    const block = proposeBlock(
      this.keys,
      this.publicKeyB64u,
      this.chain.height,
      this.chain.head(),
      entries,
      ts,
      round,
      authorityAdd,
      authorityRemove,
    );
    const result = this.chain.apply(block);
    if (!result.ok) throw new Error(`refused to propose an invalid block: ${result.reason}`);
    if (authorityAdd) this.pendingAuthorityAdds.shift(); // it's on-chain now
    if (authorityRemove) this.pendingAuthorityRemoves.shift();
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
