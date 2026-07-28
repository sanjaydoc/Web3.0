import type { Store } from '../store/index.js';

/** Where burned aETH goes — a sink no one holds keys for. Excluded from "value in network". */
export const BURN_ID = 'burn@web3.0';

export interface EconomicsSettings {
  /** Protocol fee on each payment, basis points, skimmed from the payee to the node treasury. */
  feeBps: number;
  /** aETH minted to a block's proposer (its treasury) per block. */
  blockReward: number;
  /** EIP-1559-style sink: basis points of each payment burned outright (supply reduction). */
  burnBps: number;
  /** Stake (minor units) required for permissionless authority admission. */
  authorityStake: number;
  // ── Proof-of-Contribution: rewarding plain nodes for lending uptime/compute ──────────────────
  /**
   * aETH (minor units) minted once per epoch and split across live contributing nodes by their
   * weighted contribution score. This is how running a node — not just being an authority — earns.
   * 0 disables the whole engine (default).
   */
  nodeRewardPool: number;
  /** Epoch length, in blocks. The pool is distributed once every `epochBlocks` blocks (min 1). */
  epochBlocks: number;
  /** Weight on a node's uptime (per hour online) in its contribution score. */
  uptimeWeight: number;
  /** Weight on each agent a node hosts in its contribution score. */
  hostWeight: number;
  /** Weight on each request/tx a node has served in its contribution score. */
  relayWeight: number;
  /**
   * Anti-whale cap: the maximum share of a single epoch's pool one node may take, in basis points
   * (2000 = 20%). 0 = no cap. Bounds how much any one (possibly Sybil) node can drain.
   */
  rewardCapBps: number;
}

const SETTING_KEY = 'economics';

/**
 * economics — the node's live monetary policy. Seeded from env config at first boot, then owned by
 * the GUI (admin-editable at runtime, persisted in the Store). Everything that charges fees, mints
 * rewards, or burns reads the CURRENT values from here, so changes apply immediately — no restart.
 */
export class EconomicsService {
  private current: EconomicsSettings;

  constructor(
    private readonly store: Store,
    seed: EconomicsSettings,
  ) {
    this.current = { ...seed };
  }

  async load(): Promise<void> {
    const saved = await this.store.loadSetting<Partial<EconomicsSettings>>(SETTING_KEY);
    if (saved) this.current = { ...this.current, ...saved };
  }

  get(): EconomicsSettings {
    return { ...this.current };
  }
  get feeBps(): number {
    return this.current.feeBps;
  }
  get blockReward(): number {
    return this.current.blockReward;
  }
  get burnBps(): number {
    return this.current.burnBps;
  }
  get authorityStake(): number {
    return this.current.authorityStake;
  }
  get nodeRewardPool(): number {
    return this.current.nodeRewardPool;
  }
  get epochBlocks(): number {
    return this.current.epochBlocks;
  }
  get uptimeWeight(): number {
    return this.current.uptimeWeight;
  }
  get hostWeight(): number {
    return this.current.hostWeight;
  }
  get relayWeight(): number {
    return this.current.relayWeight;
  }
  get rewardCapBps(): number {
    return this.current.rewardCapBps;
  }

  /** Update (partial) and persist. Values are clamped to sane ranges. */
  async update(patch: Partial<EconomicsSettings>): Promise<EconomicsSettings> {
    const clampBps = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.min(10_000, Math.round(Number(v)))) : fallback;
    const clampAmt = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : fallback;
    // Weights are non-negative reals (not clamped to a ceiling) — only their ratios matter.
    const clampWeight = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : fallback;
    const pick = <K extends keyof EconomicsSettings>(
      key: K,
      clamp: (v: unknown, fallback: number) => number,
    ): number =>
      patch[key] !== undefined ? clamp(patch[key], this.current[key]) : this.current[key];
    this.current = {
      feeBps: pick('feeBps', clampBps),
      blockReward: pick('blockReward', clampAmt),
      burnBps: pick('burnBps', clampBps),
      authorityStake: pick('authorityStake', clampAmt),
      nodeRewardPool: pick('nodeRewardPool', clampAmt),
      // At least one block per epoch — a 0/NaN epoch would divide by zero in the scheduler.
      epochBlocks:
        patch.epochBlocks !== undefined
          ? Math.max(1, Math.round(Number(patch.epochBlocks) || this.current.epochBlocks))
          : this.current.epochBlocks,
      uptimeWeight: pick('uptimeWeight', clampWeight),
      hostWeight: pick('hostWeight', clampWeight),
      relayWeight: pick('relayWeight', clampWeight),
      rewardCapBps: pick('rewardCapBps', clampBps),
    };
    await this.store.saveSetting(SETTING_KEY, this.current);
    return this.get();
  }
}
