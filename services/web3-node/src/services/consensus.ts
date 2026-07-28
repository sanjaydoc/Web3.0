import { type Block, ConsensusEngine, hashBlock } from '@web3/consensus';
import type { SignedTx } from '@web3/core';
import { fromB64u, verifyString } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import { toB64u } from '@web3/crypto';
import type { Ledger } from '@web3/ledger';
import type { ConsensusConfig } from '../config.js';
import {
  CONTRIBUTION_POOL_ID,
  type ContributionReport,
  ContributionService,
  type ContributionWeights,
  type Heartbeat,
  signHeartbeat,
} from './contribution.js';
import type { AcceptResult, Mempool } from './mempool.js';
import type { NetworkAccounts } from './network-accounts.js';

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
/** Where authority stakes are escrowed on the ledger (the "deposit contract"). */
export const STAKE_ESCROW_ID = 'stake@web3.0';
/** Payment-memo prefix that binds a stake to a node key: `authority-stake:<base64url key>`. */
export const STAKE_MEMO_PREFIX = 'authority-stake:';
/** Refund memo prefix (escrow → staker) for voluntary exits. */
export const UNSTAKE_MEMO_PREFIX = 'authority-unstake:';
/** Slash memo prefix (escrow → burn) when an authority equivocates. */
export const SLASH_MEMO_PREFIX = 'authority-slash:';
/** Where slashed stakes go — same sink as the fee burn. */
const BURN_SINK = 'burn@web3.0';
/** Memo tagging a Proof-of-Contribution reward mint: `node-reward:<epoch>`. */
export const NODE_REWARD_MEMO_PREFIX = 'node-reward:';

/** Live Proof-of-Contribution policy, read at use-time (GUI-editable economics). */
export interface RewardPolicy {
  treasuryId: string;
  /** Live values (GUI-editable economics) — read at use time, not construction. */
  blockReward: () => number;
  authorityStake: () => number;
  /** aETH minted per epoch and split across live contributing nodes (0 = engine off). */
  nodeRewardPool?: () => number;
  /** Epoch length in blocks — the pool is distributed once every this many blocks. */
  epochBlocks?: () => number;
  /** Contribution-score weights (uptime per hour / hosted agent / served request). */
  weights?: () => ContributionWeights;
  /** Max share of one epoch's pool a single node may take, in basis points (0 = uncapped). */
  rewardCapBps?: () => number;
}

export class ConsensusCoordinator {
  readonly enabled: boolean;
  readonly engine: ConsensusEngine | null;
  private includedLocalEntries = 0;
  /** Foreign entry hashes already applied to local balances (replication dedupe). */
  private readonly appliedExternal = new Set<string>();
  /** height → committed {proposer, hash}: the evidence base for equivocation (double-sign) slashing. */
  private readonly committedAt = new Map<number, { proposer: string; hash: string }>();
  private readonly slashed = new Set<string>();

  /**
   * Trustless-write plumbing (set by the kernel). `mempool` validates + queues account-signed txs;
   * `accounts` is the chain-fed key/nonce index. `broadcastTx` gossips a locally-submitted tx to
   * peers so it reaches an authority. All optional so the coordinator stays testable in isolation.
   */
  private readonly mempool?: Mempool;
  private readonly accounts?: NetworkAccounts;
  broadcastTx?: (tx: SignedTx) => void;

  /** Registry of peer contribution heartbeats — the input to epoch reward distribution. */
  readonly contribution: ContributionService;
  /** Set by the networking module so this coordinator can gossip its own heartbeat to peers. */
  broadcastHeartbeat?: (hb: Heartbeat) => void;
  private readonly nodeKeys: Keypair;

  constructor(
    private readonly config: ConsensusConfig,
    nodeKeys: Keypair,
    private readonly ledger: Ledger,
    private readonly rewards: RewardPolicy = {
      treasuryId: '',
      blockReward: () => 0,
      authorityStake: () => 0,
    },
    deps: {
      mempool?: Mempool;
      accounts?: NetworkAccounts;
      contribution?: ContributionService;
    } = {},
  ) {
    this.enabled = config.mode === 'poa';
    this.mempool = deps.mempool;
    this.accounts = deps.accounts;
    this.nodeKeys = nodeKeys;
    this.contribution = deps.contribution ?? new ContributionService();
    const authority = toB64u(nodeKeys.publicKey);
    // Default to a single-authority chain (this node) if none configured, so `poa` always works.
    const authorities = config.authorities.length > 0 ? config.authorities : [authority];
    this.engine = this.enabled
      ? new ConsensusEngine(nodeKeys, authority, authorities, undefined, config.slotMs)
      : null;
  }

  /**
   * Validate + queue an account-signed transaction (from this node's dashboard or a peer's gossip).
   * The mempool proves ownership/nonce/balance before anything is queued. Sealing happens later:
   * an authority seals on its turn (proposeTick); a solo node with consensus off seals immediately,
   * since it is the only writer. Returns the mempool verdict.
   */
  acceptTx(tx: SignedTx): AcceptResult {
    if (!this.mempool) return { ok: false, reason: 'transactions not enabled on this node' };
    const result = this.mempool.accept(tx);
    // Solo/authority-less node: no blocks will ever seal it, so apply it now (this node is the
    // sole source of truth). PoA nodes wait for an authority's block instead.
    if (result.ok && !result.duplicate && !this.enabled) this.mempool.drainAndSeal();
    return result;
  }

  /** Submit a tx that originated on THIS node: accept it, then gossip it to peers (if PoA). */
  submitTx(tx: SignedTx): AcceptResult {
    const result = this.acceptTx(tx);
    if (result.ok && !result.duplicate && this.enabled) this.broadcastTx?.(tx);
    return result;
  }

  /** The next nonce a client should sign with for `account` (chain state + local queue). */
  nextNonce(account: string): number {
    return this.mempool?.nextNonce(account) ?? this.accounts?.nonceOf(account) ?? 0;
  }

  // ── Proof-of-Contribution heartbeats ─────────────────────────────────────────────────────────

  /** Sign a contribution report with this node's key, ready to gossip to peers. */
  signContribution(report: ContributionReport): Heartbeat {
    return signHeartbeat(this.nodeKeys, report);
  }

  /**
   * Ingest a peer's (or our own) contribution heartbeat into the registry. Returns whether it was
   * accepted AND newer than what we held — the networking module re-gossips only in that case.
   */
  ingestHeartbeat(hb: Heartbeat): boolean {
    return this.contribution.ingest(hb);
  }

  /**
   * Propose a block from this node's not-yet-blocked ledger entries when it's due — in-turn, or
   * out-of-turn once earlier authorities have missed their slots (proposer-skip keeps the chain
   * live if a node is down).
   */
  /** Net on-ledger stake for a node key: escrow inflows minus refunds and slashes. */
  stakeOf(key: string): number {
    let total = 0;
    for (const e of this.ledger.all()) {
      if (e.type !== 'payment') continue;
      const d = e.data as { from?: string | null; to?: string; amount?: number; memo?: string };
      if (d.to === STAKE_ESCROW_ID && d.memo === `${STAKE_MEMO_PREFIX}${key}`) {
        total += d.amount ?? 0;
      }
      if (
        d.from === STAKE_ESCROW_ID &&
        (d.memo === `${UNSTAKE_MEMO_PREFIX}${key}` || d.memo === `${SLASH_MEMO_PREFIX}${key}`)
      ) {
        total -= d.amount ?? 0;
      }
    }
    return Math.max(0, total);
  }

  /** Queue an on-chain removal (voluntary exit) — rides in this node's next block. */
  queueRemoval(key: string): boolean {
    if (!this.engine) return false;
    if (!this.engine.chain.authorities.includes(this.engine.publicKeyB64u)) return false;
    this.engine.queueAuthorityRemove(key);
    return true;
  }

  /**
   * Equivocation slashing: given a block claiming an already-committed height, check whether it is
   * a SECOND validly-signed block by the same proposer — cryptographic proof of double-signing.
   * If so, burn the proposer's entire stake and queue its on-chain removal. Returns the slashed
   * key, or null. Evidence is verified (hash + signature) before anyone loses anything.
   */
  private detectEquivocation(block: Block): string | null {
    const committed = this.committedAt.get(block.height);
    if (!committed) return null;
    if (committed.proposer !== block.proposer || committed.hash === block.hash) return null;
    if (this.slashed.has(block.proposer)) return null;
    if (hashBlock(block) !== block.hash) return null; // forged evidence
    if (!verifyString(fromB64u(block.proposer), block.hash, block.signature)) return null;
    // Proven double-sign. Burn the stake (if any) and remove the authority on-chain.
    this.slashed.add(block.proposer);
    const stake = this.stakeOf(block.proposer);
    if (stake > 0) {
      this.ledger.transfer(
        STAKE_ESCROW_ID as Parameters<Ledger['transfer']>[0],
        BURN_SINK as Parameters<Ledger['transfer']>[0],
        stake,
        { memo: `${SLASH_MEMO_PREFIX}${block.proposer}` },
      );
    }
    this.engine?.queueAuthorityRemove(block.proposer);
    return block.proposer;
  }

  private recordCommitted(block: Block): void {
    this.committedAt.set(block.height, { proposer: block.proposer, hash: block.hash });
  }

  /**
   * State replication: apply the balance effects of a committed block's FOREIGN entries into this
   * node's ledger (entries this node authored are already local). Dedupe by entry hash, so gossip
   * replays and reconnect re-syncs are idempotent.
   */
  private replicate(block: Block): void {
    const local = new Set(this.ledger.all().map((e) => e.hash));
    for (const entry of block.entries) {
      // Learn account key-bindings and advance sender nonces from EVERY entry in the block, even
      // ones this node authored — this is how a peer discovers accounts created elsewhere and keeps
      // its nonce view in sync with the chain.
      this.accounts?.observe(entry);
      if (local.has(entry.hash) || this.appliedExternal.has(entry.hash)) continue;
      this.ledger.applyExternal(entry);
      this.appliedExternal.add(entry.hash);
    }
    // A sealed block may have consumed nonces our mempool was still holding — drop the dead txs.
    this.mempool?.prune();
  }

  /**
   * Permissionless admission (Ethereum-style): any key whose escrowed stake meets the threshold is
   * queued for on-chain seating — the membership change rides in the next block this node proposes.
   * No admin in the loop; the "activation queue" is simply the block cadence.
   */
  private queueStakedAuthorities(): void {
    if (!this.engine || this.rewards.authorityStake() <= 0) return;
    const totals = new Map<string, number>();
    for (const e of this.ledger.all()) {
      if (e.type !== 'payment') continue;
      const d = e.data as { to?: string; amount?: number; memo?: string };
      if (d.to !== STAKE_ESCROW_ID || !d.memo?.startsWith(STAKE_MEMO_PREFIX)) continue;
      const key = d.memo.slice(STAKE_MEMO_PREFIX.length);
      totals.set(key, (totals.get(key) ?? 0) + (d.amount ?? 0));
    }
    for (const [key, total] of totals) {
      if (total >= this.rewards.authorityStake() && !this.engine.chain.authorities.includes(key)) {
        this.engine.queueAuthorityAdd(key);
      }
    }
  }

  /**
   * Has ANY authority already minted the Proof-of-Contribution reward for `epoch`? Derived from the
   * replicated ledger (not local memory), so once one authority pays an epoch, every node — the
   * next proposer included — sees it and never double-pays. Blocks apply in strict height order, so
   * a proposer always holds the prior block (and its reward mint) before it can propose the next.
   */
  private epochAlreadyRewarded(epoch: number): boolean {
    const memo = `${NODE_REWARD_MEMO_PREFIX}${epoch}`;
    for (const e of this.ledger.all()) {
      if (e.type !== 'payment') continue;
      if ((e.data as { memo?: string }).memo === memo) return true;
    }
    return false;
  }

  /**
   * At an epoch boundary, split the reward pool across live contributing nodes and mint each share
   * INTO the block being proposed (so it replicates to every node). `nextHeight` is the height of
   * the block about to be proposed. Returns the number of shares minted (0 = nothing to do).
   */
  private distributeEpochRewards(nextHeight: number): number {
    const epochBlocks = Math.max(1, this.rewards.epochBlocks?.() ?? 0);
    // Reward only on the block that first completes an epoch (heights are strictly sequential, so
    // every multiple is hit exactly once). Nothing to pay at genesis or mid-epoch.
    if (nextHeight <= 0 || nextHeight % epochBlocks !== 0) return 0;
    const epoch = nextHeight / epochBlocks - 1; // the epoch that just finished
    if (this.epochAlreadyRewarded(epoch)) return 0;
    // Optional bootstrap subsidy: if configured, mint a top-up INTO the pool (off by default, so the
    // pool stays purely fee-funded / non-inflationary unless an operator opts into bootstrapping).
    const subsidy = this.rewards.nodeRewardPool?.() ?? 0;
    if (subsidy > 0) {
      this.ledger.mint(CONTRIBUTION_POOL_ID as Parameters<Ledger['mint']>[0], subsidy);
    }
    // Distribute the contribution-pool wallet's balance — fed by the 1% pool slice of every
    // payment/hosting fee (+ any subsidy above) — across contributing nodes by score, via transfers
    // FROM the pool. Empty pool ⇒ nothing to pay this epoch.
    const pool = this.ledger.balanceOf(CONTRIBUTION_POOL_ID);
    if (pool <= 0) return 0;
    const weights = this.rewards.weights?.() ?? { uptime: 1, host: 1, relay: 1 };
    const capBps = this.rewards.rewardCapBps?.() ?? 0;
    const shares = this.contribution.distribute(pool, weights, capBps);
    for (const share of shares) {
      this.ledger.transfer(
        CONTRIBUTION_POOL_ID,
        share.wallet as Parameters<Ledger['mint']>[0],
        share.amount,
        {
          memo: `${NODE_REWARD_MEMO_PREFIX}${epoch}`,
        },
      );
    }
    return shares.length;
  }

  proposeTick(): Block | null {
    if (!this.engine) return null;
    this.queueStakedAuthorities();
    // Seal queued account-signed txs into node payments ONLY when this node is the due proposer —
    // so exactly one authority seals each tx (drainAndSeal mutates the ledger, so an out-of-turn
    // node must not run it). The sealed payments then batch into the block below.
    const now = Date.now();
    const due = this.engine.isDue(now);
    if (this.mempool && due) this.mempool.drainAndSeal();
    // Nothing new since our last block? Don't propose. Reward mints are marked included the instant
    // they're minted (below), so a block reward can never masquerade as pending activity — this is
    // what prevents an endless chain of empty, self-rewarding blocks.
    if (this.ledger.all().length === this.includedLocalEntries) return null;
    // Real pending activity on our slot: mint the block reward so it is sealed INTO this block (not
    // appended AFTER it, where it would trigger the next block), then propose activity + reward
    // together.
    if (due) {
      const reward = this.rewards.blockReward();
      if (reward > 0 && this.rewards.treasuryId) {
        this.ledger.mint(this.rewards.treasuryId as Parameters<Ledger['mint']>[0], reward);
      }
      // Proof-of-Contribution: at an epoch boundary, pay live contributing nodes from the pool.
      // Minted into THIS block so every node applies the same payouts deterministically.
      this.distributeEpochRewards(this.engine.height);
    }
    const pending = this.ledger.all().slice(this.includedLocalEntries);
    const block = this.engine.proposeIfDue(pending, now);
    if (block) {
      this.recordCommitted(block);
      // Mark EVERYTHING committed — including the reward mint — so it never re-triggers a block.
      this.includedLocalEntries = this.ledger.all().length;
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

  /**
   * Apply a block received from a peer; returns whether it was accepted (new + valid), plus the
   * slashed key when the block is proof of a double-sign.
   */
  ingest(block: Block): { ok: boolean; reason?: string; slashed?: string } {
    if (!this.engine) return { ok: false, reason: 'consensus disabled' };
    // A block for an already-committed height is either idempotent gossip — or evidence.
    if (block.height < this.engine.height) {
      const slashed = this.detectEquivocation(block);
      return slashed ? { ok: true, slashed } : { ok: true };
    }
    const result = this.engine.receive(block);
    if (result.ok) {
      this.recordCommitted(block);
      this.replicate(block);
    }
    return result;
  }

  /**
   * Is this node allowed to seal writes itself? True for a solo/consensus-off node (it's the only
   * writer) and for a PoA node that is in the live authority set. A PoA FOLLOWER returns false —
   * its privileged writes (account registration, faucet) must be forwarded to an authority.
   */
  isAuthority(): boolean {
    if (!this.engine) return true;
    return this.engine.chain.authorities.includes(this.engine.publicKeyB64u);
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
