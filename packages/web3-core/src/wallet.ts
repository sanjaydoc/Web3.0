import type { Web3Id } from './id.js';

/**
 * ACP settles value in its own native unit, `aETH` — a free-floating token (ETH-style), whose value
 * is set by demand for network work, not pegged to any fiat. For the MVP it's an internal
 * ledger credit with no market value; the roadmap issues it on-chain (and can optionally settle via
 * an external stablecoin rail), keeping the same amount semantics.
 */
export type Currency = 'aETH';

export const DEFAULT_CURRENCY: Currency = 'aETH';

/** Number of decimal places a currency subdivides into. */
export const CURRENCY_DECIMALS: Record<Currency, number> = { aETH: 2 };

/**
 * An amount is stored as an integer number of minor units to avoid floating-point drift.
 * `250` minor units = `2.50 aETH` (the MVP subdivides to 2 dp; on-chain issuance can widen this).
 */
export type Amount = number;

export interface Wallet {
  owner: Web3Id;
  currency: Currency;
  /** Balance in minor units. */
  balance: Amount;
}

/** Convert a decimal major-unit value (e.g. 2.5) to minor units (250). */
export function toMinorUnits(major: number, currency: Currency = DEFAULT_CURRENCY): Amount {
  return Math.round(major * 10 ** CURRENCY_DECIMALS[currency]);
}

/** Format an amount for display, e.g. `formatAmount(250)` → `"2.50 aETH"`. */
export function formatAmount(amount: Amount, currency: Currency = DEFAULT_CURRENCY): string {
  const value = (amount / 10 ** CURRENCY_DECIMALS[currency]).toFixed(CURRENCY_DECIMALS[currency]);
  return `${value} ${currency}`;
}

export function isValidAmount(amount: unknown): amount is Amount {
  return typeof amount === 'number' && Number.isInteger(amount) && amount >= 0;
}
