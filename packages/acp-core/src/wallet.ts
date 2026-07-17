import type { Web3Id } from './id.js';

/**
 * ACP settles value in a stablecoin-denominated unit. For the MVP this is `aUSD` — an internal
 * ledger credit pegged 1:1 to a US-dollar stablecoin. The roadmap swaps this for on-chain
 * settlement (testnet USDC via x402), keeping the same amount semantics.
 */
export type Currency = 'aUSD';

export const DEFAULT_CURRENCY: Currency = 'aUSD';

/** Number of decimal places a currency subdivides into. */
export const CURRENCY_DECIMALS: Record<Currency, number> = { aUSD: 2 };

/**
 * An amount is stored as an integer number of minor units (e.g. cents) to avoid floating-point
 * drift. `250` aUSD-minor-units = $2.50.
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

/** Format an amount for display, e.g. `formatAmount(250)` → `"2.50 aUSD"`. */
export function formatAmount(amount: Amount, currency: Currency = DEFAULT_CURRENCY): string {
  const value = (amount / 10 ** CURRENCY_DECIMALS[currency]).toFixed(CURRENCY_DECIMALS[currency]);
  return `${value} ${currency}`;
}

export function isValidAmount(amount: unknown): amount is Amount {
  return typeof amount === 'number' && Number.isInteger(amount) && amount >= 0;
}
