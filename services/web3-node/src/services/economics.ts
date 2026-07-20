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

  /** Update (partial) and persist. Values are clamped to sane ranges. */
  async update(patch: Partial<EconomicsSettings>): Promise<EconomicsSettings> {
    const clampBps = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.min(10_000, Math.round(Number(v)))) : fallback;
    const clampAmt = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : fallback;
    this.current = {
      feeBps:
        patch.feeBps !== undefined
          ? clampBps(patch.feeBps, this.current.feeBps)
          : this.current.feeBps,
      blockReward:
        patch.blockReward !== undefined
          ? clampAmt(patch.blockReward, this.current.blockReward)
          : this.current.blockReward,
      burnBps:
        patch.burnBps !== undefined
          ? clampBps(patch.burnBps, this.current.burnBps)
          : this.current.burnBps,
      authorityStake:
        patch.authorityStake !== undefined
          ? clampAmt(patch.authorityStake, this.current.authorityStake)
          : this.current.authorityStake,
    };
    await this.store.saveSetting(SETTING_KEY, this.current);
    return this.get();
  }
}
