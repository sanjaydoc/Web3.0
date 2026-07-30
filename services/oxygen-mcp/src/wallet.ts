/**
 * The Oxygen wallet: an x402 payer with a USDC balance view. Balance is tracked locally against a
 * starting float (self-contained demo / ledger mode) unless a real chain RPC is configured, in which
 * case it reads the on-chain USDC balance via `eth_call balanceOf`. Spend is always tracked so the
 * "Spent $X total" line is honest either way.
 */

import { privateKeyToAddress, randomPrivateKey, walletFromPrivateKey } from '@web3/x402';
import type { X402Wallet } from '@web3/x402';

const USDC_DECIMALS = 6;

export interface WalletConfig {
  /** secp256k1 private key (0x-hex). Generated ephemerally if absent. */
  privateKey?: string;
  /** Starting balance in atomic USDC units when running in local/ledger mode. Default 50 USDC. */
  startingAtomic?: string;
  /** EVM RPC URL — when set, balance is read on-chain instead of tracked locally. */
  rpcUrl?: string;
  /** USDC contract address for on-chain balance reads. */
  asset?: string;
}

/** Format atomic USDC (6dp) as a `$xx.xx` string. */
export function formatUsdc(atomic: string | bigint): string {
  const v = BigInt(atomic);
  const whole = v / 10n ** BigInt(USDC_DECIMALS);
  const frac = (v % 10n ** BigInt(USDC_DECIMALS))
    .toString()
    .padStart(USDC_DECIMALS, '0')
    .slice(0, 2);
  return `$${whole.toString()}.${frac}`;
}

export class OxygenWallet {
  readonly signer: X402Wallet;
  readonly address: string;
  private spentAtomic = 0n;
  private paymentCount = 0;
  private readonly startingAtomic: bigint;

  constructor(private readonly cfg: WalletConfig) {
    const key = cfg.privateKey || randomPrivateKey();
    this.signer = walletFromPrivateKey(key);
    this.address = privateKeyToAddress(key);
    this.startingAtomic = BigInt(cfg.startingAtomic ?? '50000000'); // 50.00 USDC
  }

  /** Record a payment against the local balance/spend counters. */
  recordSpend(atomic: string): void {
    this.spentAtomic += BigInt(atomic);
    this.paymentCount += 1;
  }

  get spent(): bigint {
    return this.spentAtomic;
  }
  get payments(): number {
    return this.paymentCount;
  }

  /** The current spendable balance in atomic units. */
  async balanceAtomic(): Promise<bigint> {
    if (this.cfg.rpcUrl && this.cfg.asset) {
      const onChain = await this.readOnChainBalance().catch(() => null);
      if (onChain !== null) return onChain;
    }
    const local = this.startingAtomic - this.spentAtomic;
    return local > 0n ? local : 0n;
  }

  /** ERC-20 `balanceOf(address)` via a raw JSON-RPC `eth_call` (dependency-free). */
  private async readOnChainBalance(): Promise<bigint> {
    const selector = '70a08231'; // keccak256("balanceOf(address)")[:4]
    const addr = this.address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
    const res = await fetch(this.cfg.rpcUrl as string, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: this.cfg.asset, data: `0x${selector}${addr}` }, 'latest'],
      }),
    });
    const body = (await res.json()) as { result?: string };
    return body.result ? BigInt(body.result) : 0n;
  }
}
