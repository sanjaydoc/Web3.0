import type { Keypair } from '@acp/crypto';
import type { LedgerEntry } from '@acp/ledger';
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

  constructor(
    private readonly keys: Keypair,
    readonly publicKeyB64u: string,
    authorities: string[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.chain = new Blockchain(authorities);
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

  /** Validate and apply a block received from a peer. */
  receive(block: Block): BlockValidation {
    return this.chain.apply(block);
  }
}
