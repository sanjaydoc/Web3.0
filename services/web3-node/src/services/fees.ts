import type { Web3Id } from '@web3/core';
import type { Ledger } from '@web3/ledger';

/**
 * Split a collected fee three ways — 1/1/1 at the default 3% rate — with **no minting**. The money is
 * skimmed from `from` (real, existing aETH) and re-routed to: the platform treasury, the node that did
 * the work (its own withdrawable wallet), and the fee-funded contribution pool. Integer-exact — the
 * rounding remainder goes to the pool. The caller must ensure `from` holds at least `fee`.
 *
 * This is what makes rewards non-inflationary: every reward is recycled from a real fee, never printed.
 */
export function splitFee(
  ledger: Ledger,
  from: Web3Id,
  fee: number,
  dest: { treasury: Web3Id; node: Web3Id; pool: Web3Id },
  memoTag: string,
): { treasury: number; node: number; pool: number } {
  if (fee <= 0) return { treasury: 0, node: 0, pool: 0 };
  const treasury = Math.floor(fee / 3);
  const node = Math.floor(fee / 3);
  const pool = fee - treasury - node; // remainder → pool, so the parts always sum to `fee`
  if (treasury > 0) ledger.transfer(from, dest.treasury, treasury, { memo: `${memoTag}-treasury` });
  if (node > 0) ledger.transfer(from, dest.node, node, { memo: `${memoTag}-node` });
  if (pool > 0) ledger.transfer(from, dest.pool, pool, { memo: `${memoTag}-pool` });
  return { treasury, node, pool };
}
