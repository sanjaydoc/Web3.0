import { type Block, ConsensusEngine } from '@web3/consensus';
import type { Keypair } from '@web3/crypto';
import { toB64u } from '@web3/crypto';
import type { Ledger } from '@web3/ledger';
import type { ConsensusConfig } from '../config.js';

export interface ConsensusStatus {
  mode: 'off' | 'poa';
  enabled: boolean;
  authority: string;
  authorities: string[];
  height: number;
  head: string;
  proposerNow: string | null;
  isMyTurn: boolean;
  peers: string[];
}

/**
 * Wires the node into the PoA chain (@web3/consensus). It batches this node's newly-appended ledger
 * entries into blocks when it's this node's turn, applies blocks received from peers, and reports
 * status. Networking (dialing peers, broadcasting) lives in the `consensus` module; this class is
 * the pure, testable coordination logic.
 *
 * Scope note: blocks form a **replicated, ordered log** agreed by the authorities. Applying another
 * node's entries into this node's local wallet balances (full state-machine replication) is the
 * documented next step; here each node keeps its own ledger and the chain orders the block stream.
 */
export class ConsensusCoordinator {
  readonly enabled: boolean;
  readonly engine: ConsensusEngine | null;
  private includedLocalEntries = 0;

  constructor(
    private readonly config: ConsensusConfig,
    nodeKeys: Keypair,
    private readonly ledger: Ledger,
    private readonly rewards: { treasuryId: string; blockReward: number } = {
      treasuryId: '',
      blockReward: 0,
    },
  ) {
    this.enabled = config.mode === 'poa';
    const authority = toB64u(nodeKeys.publicKey);
    // Default to a single-authority chain (this node) if none configured, so `poa` always works.
    const authorities = config.authorities.length > 0 ? config.authorities : [authority];
    this.engine = this.enabled
      ? new ConsensusEngine(nodeKeys, authority, authorities, undefined, config.slotMs)
      : null;
  }

  /**
   * Propose a block from this node's not-yet-blocked ledger entries when it's due — in-turn, or
   * out-of-turn once earlier authorities have missed their slots (proposer-skip keeps the chain
   * live if a node is down).
   */
  proposeTick(): Block | null {
    if (!this.engine) return null;
    const all = this.ledger.all();
    const pending = all.slice(this.includedLocalEntries);
    if (pending.length === 0) return null;
    const block = this.engine.proposeIfDue(pending, Date.now());
    if (block) {
      this.includedLocalEntries = all.length;
      // Block reward: producing a block mints aETH to this node's treasury (operator incentive).
      if (this.rewards.blockReward > 0 && this.rewards.treasuryId) {
        this.ledger.mint(
          this.rewards.treasuryId as Parameters<Ledger['mint']>[0],
          this.rewards.blockReward,
        );
      }
    }
    return block;
  }

  /**
   * Seat a new authority on-chain: queue an `authorityAdd` that rides in the next block this node
   * proposes, so every node in the network applies the membership change deterministically — no
   * restarts, no config edits. Only works when this node is itself an authority on a live chain.
   */
  seatAuthority(key: string): { seated: boolean; note: string } {
    if (!this.engine) {
      return {
        seated: false,
        note: 'solo node — no shared chain to seat into (recorded for when the network launches)',
      };
    }
    const me = this.engine.publicKeyB64u;
    if (!this.engine.chain.authorities.includes(me)) {
      return {
        seated: false,
        note: 'this node is a relay, not an authority — approve from an authority node to seat on-chain',
      };
    }
    if (this.engine.chain.authorities.includes(key)) {
      return { seated: true, note: 'already an authority' };
    }
    this.engine.queueAuthorityAdd(key);
    return {
      seated: true,
      note: 'queued on-chain — seated when this node next proposes a block; all nodes apply it automatically',
    };
  }

  /** Apply a block received from a peer; returns whether it was accepted (new + valid). */
  ingest(block: Block): { ok: boolean; reason?: string } {
    if (!this.engine) return { ok: false, reason: 'consensus disabled' };
    // Ignore blocks we already have (idempotent gossip).
    if (block.height < this.engine.height) return { ok: true };
    return this.engine.receive(block);
  }

  status(): ConsensusStatus {
    const authorities = [...(this.engine?.chain.authorities ?? this.config.authorities)];
    const height = this.engine?.height ?? 0;
    return {
      mode: this.config.mode,
      enabled: this.enabled,
      authority: this.engine?.publicKeyB64u ?? '',
      authorities,
      height,
      head: this.engine?.head() ?? '0'.repeat(64),
      proposerNow: this.engine ? this.engine.chain.expectedProposer(height) : null,
      isMyTurn: this.engine?.isMyTurn() ?? false,
      peers: this.config.peers,
    };
  }
}
