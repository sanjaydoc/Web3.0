import type { AccountData, LedgerEntry, PaymentData } from '@web3/ledger';

/** A network account as learned from the chain: its address, role, and transaction-signing key. */
export interface BoundAccount {
  address: string;
  role: string;
  /** base64url ML-DSA public key that authorises this account's transactions. */
  pubkey: string;
  did: string;
}

/**
 * The network's view of accounts, built purely from chain entries — so it is identical on every
 * node, authority or untrusted peer. Two things live here:
 *
 *   1. **Key bindings** (address → pubkey), from `account` entries. This is what lets any node
 *      verify that an account-signed transaction really came from that account's owner.
 *   2. **Nonces** (address → next expected), from the `nonce` stamped on tx-sealed `payment`
 *      entries. Derivable from the chain means replay protection survives restarts and re-syncs.
 *
 * Feed EVERY entry the node sees through `observe()`: its own appends (via `Ledger.onAppend`),
 * foreign entries in received blocks (via the consensus replicate path), and hydrated history on
 * startup. `observe` is idempotent per entry, so replays and reconnects are safe.
 */
export class NetworkAccounts {
  private readonly byAddress = new Map<string, BoundAccount>();
  /** address → next expected nonce (0 until the account has had a tx sealed). */
  private readonly nextNonce = new Map<string, number>();

  observe(entry: LedgerEntry): void {
    if (entry.type === 'account') {
      const d = entry.data as AccountData;
      // Last binding wins — an account may re-key (a future rotation flow).
      this.byAddress.set(d.web3Id, {
        address: d.web3Id,
        role: d.role,
        pubkey: d.pubkey,
        did: d.did,
      });
    } else if (entry.type === 'payment') {
      const d = entry.data as PaymentData;
      // Only tx-sealed payments carry a nonce; advance the sender's expected nonce past it.
      if (d.from && typeof d.nonce === 'number') {
        const next = d.nonce + 1;
        if (next > (this.nextNonce.get(d.from) ?? 0)) this.nextNonce.set(d.from, next);
      }
    }
  }

  has(address: string): boolean {
    return this.byAddress.has(address);
  }

  get(address: string): BoundAccount | undefined {
    return this.byAddress.get(address);
  }

  pubkeyOf(address: string): string | undefined {
    return this.byAddress.get(address)?.pubkey;
  }

  roleOf(address: string): string | undefined {
    return this.byAddress.get(address)?.role;
  }

  /** The next nonce this account must use — one past its last chain-sealed tx (0 if none). */
  nonceOf(address: string): number {
    return this.nextNonce.get(address) ?? 0;
  }

  list(): BoundAccount[] {
    return [...this.byAddress.values()];
  }

  get size(): number {
    return this.byAddress.size;
  }
}
