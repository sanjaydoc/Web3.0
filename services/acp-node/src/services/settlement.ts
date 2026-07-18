import { hashJson } from '@acp/crypto';
import type { SettlementConfig } from '../config.js';

/** A request to settle value between two accounts, in integer minor units of the currency. */
export interface SettlementIntent {
  from: string;
  to: string;
  amount: number;
  currency: string;
  reference: string; // ties the settlement to a ledger entry (its hash) or task id
}

/** The outcome of a settlement attempt, attached to the payment receipt. */
export interface SettlementResult {
  /** Which rail settled the value. */
  network: string;
  /** `settled` = final; `pending` = broadcast/confirmation still needed; `failed` = rail error. */
  status: 'settled' | 'pending' | 'failed';
  /** A transaction reference (ledger hash, simulated hash, or on-chain tx hash) when available. */
  txRef?: string;
  /** Confirmations observed, for chain-backed rails. */
  confirmations?: number;
  /** A block-explorer link, when the rail and config provide one. */
  explorerUrl?: string;
  /** Human-readable detail (e.g. why a testnet transfer is pending). */
  detail?: string;
}

export interface SettlementProvider {
  readonly mode: SettlementConfig['mode'];
  readonly network: string;
  settle(intent: SettlementIntent): Promise<SettlementResult>;
  /** A one-line description of the active rail, for logs and the `/settlement` endpoint. */
  describe(): string;
}

/**
 * internal — the ACP ledger IS the settlement. The transfer has already been recorded on the
 * PQC-signed ledger by the time we're called; we just surface its hash as the tx reference. This is
 * the default and keeps the MVP self-contained.
 */
export class InternalSettlement implements SettlementProvider {
  readonly mode = 'internal' as const;
  readonly network = 'acp-ledger';
  async settle(intent: SettlementIntent): Promise<SettlementResult> {
    return { network: this.network, status: 'settled', txRef: intent.reference, confirmations: 1 };
  }
  describe(): string {
    return 'internal ACP ledger (PQC-signed) — value settles on the local ledger';
  }
}

/**
 * simulated — mimic an on-chain stablecoin transfer without a chain: derive a deterministic pseudo
 * tx hash from the intent and report it settled with confirmations. Useful for demoing the external
 * settlement flow (receipts, explorer links) end to end without touching real infrastructure.
 */
export class SimulatedSettlement implements SettlementProvider {
  readonly mode = 'simulated' as const;
  constructor(private readonly config: SettlementConfig) {}
  get network(): string {
    return this.config.network === 'acp-ledger' ? 'sim-stablecoin' : this.config.network;
  }
  async settle(intent: SettlementIntent): Promise<SettlementResult> {
    const txRef = `0x${hashJson([intent.from, intent.to, intent.amount, intent.reference])}`;
    const explorerUrl = this.config.explorerBaseUrl
      ? `${this.config.explorerBaseUrl.replace(/\/$/, '')}/tx/${txRef}`
      : undefined;
    return { network: this.network, status: 'settled', txRef, confirmations: 6, explorerUrl };
  }
  describe(): string {
    return `simulated stablecoin on "${this.network}" — deterministic tx refs, no real chain`;
  }
}

/**
 * testnet — the honest bridge to a real EVM testnet. It builds a *real* ERC-20 `transfer` calldata
 * and (if an RPC is configured) confirms it can reach the chain, but it will NOT broadcast: signing
 * and sending a transaction requires a funded private key, which the node deliberately never holds.
 * So it returns `pending` with the prepared calldata. Wiring a signer is the mainnet step — out of
 * scope here by design (no real funds or keys touched autonomously).
 */
export class TestnetSettlement implements SettlementProvider {
  readonly mode = 'testnet' as const;
  constructor(private readonly config: SettlementConfig) {}
  get network(): string {
    return this.config.network;
  }

  async settle(intent: SettlementIntent): Promise<SettlementResult> {
    const token = this.config.tokenAddress;
    if (!token) {
      return {
        network: this.network,
        status: 'failed',
        detail: 'testnet settlement needs ACP_SETTLEMENT_TOKEN (an ERC-20 address)',
      };
    }
    // Build the real ERC-20 transfer(address,uint256) calldata for this payment.
    const calldata = encodeErc20Transfer(
      intent.to,
      toTokenUnits(intent.amount, this.config.decimals),
    );
    let chainDetail = 'RPC not configured — calldata prepared but not verified against a chain';
    if (this.config.rpcUrl) {
      const chainId = await this.rpcChainId(this.config.rpcUrl).catch((e) => `error: ${e.message}`);
      chainDetail = `reachable chainId=${chainId}`;
    }
    return {
      network: this.network,
      status: 'pending',
      detail:
        `prepared ERC-20 transfer to ${token} (${chainDetail}). Broadcasting requires a funded ` +
        `signer, which the node does not hold — add one to go live. calldata=${calldata}`,
    };
  }

  /** Minimal JSON-RPC call (dependency-free) to prove connectivity to the testnet. */
  private async rpcChainId(rpcUrl: string): Promise<string> {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    const body = (await res.json()) as { result?: string };
    return body.result ?? 'unknown';
  }

  describe(): string {
    return `EVM testnet "${this.network}" — builds real ERC-20 transfers; never broadcasts (no signer)`;
  }
}

/** Choose the settlement provider from config. This is the one place rails are wired. */
export function createSettlement(config: SettlementConfig): SettlementProvider {
  switch (config.mode) {
    case 'simulated':
      return new SimulatedSettlement(config);
    case 'testnet':
      return new TestnetSettlement(config);
    default:
      return new InternalSettlement();
  }
}

// ── minimal EVM ABI helpers (dependency-free) ──────────────────────────────────────────────────

/** Convert integer minor units (e.g. cents) into the token's base units for the given decimals. */
export function toTokenUnits(amountMinor: number, decimals: number): bigint {
  // amountMinor is in 2-dp minor units of aETH. Scale to the settlement token's decimals.
  const scale = 10n ** BigInt(Math.max(0, decimals - 2));
  return BigInt(amountMinor) * scale;
}

/** ABI-encode `transfer(address,uint256)` → 0x + 4-byte selector + two 32-byte words. */
export function encodeErc20Transfer(to: string, value: bigint): string {
  const selector = 'a9059cbb'; // keccak256("transfer(address,uint256)")[:4]
  const addr = to.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const amount = value.toString(16).padStart(64, '0');
  return `0x${selector}${addr}${amount}`;
}
