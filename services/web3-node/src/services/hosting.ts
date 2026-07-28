import { randomUUID } from 'node:crypto';
import type { Web3Id } from '@web3/core';
import type { ModuleContext } from '../context.js';

/**
 * hosting — the compute marketplace's money + bookkeeping. A host (node operator) advertises a
 * per-epoch price to run one agent; an agent-owner rents that capacity for a specific agent, creating
 * a LEASE. Each epoch the owner is charged the lease price: the host receives the bulk and the
 * platform takes its commission (aETH earned from selling RAM). This is what turns contributed RAM
 * into demand-funded income instead of a minted, gameable pool.
 *
 * Settlement uses the internal ledger directly (like protocol fees / block rewards), so a lease bills
 * deterministically without a client signature. Leases are node-local: the owner's node bills its own
 * leases, so no cross-node double-billing.
 */

/** A host's standing offer: what it charges to run one agent for one epoch. 0 = not offering. */
export interface HostingOffer {
  host: Web3Id;
  pricePerEpoch: number; // aETH minor units per agent per epoch
  updatedAt: string;
}

/** A rental: agent-owner pays host to run `agentId`, billed `pricePerEpoch` each epoch. */
export interface Lease {
  id: string;
  owner: Web3Id;
  host: Web3Id;
  agentId: Web3Id;
  pricePerEpoch: number;
  active: boolean;
  createdAt: string;
  epochsBilled: number;
  paidTotal: number; // gross aETH the owner has paid over the life of the lease
}

/** One epoch's charge on a lease: gross paid, platform commission, net to the host. */
export interface HostingReceipt {
  leaseId: string;
  owner: Web3Id;
  host: Web3Id;
  gross: number;
  commission: number;
  net: number;
}

const OFFER_KEY = 'hosting-offer';
const LEASES_KEY = 'hosting-leases';

export class HostingService {
  constructor(private readonly ctx: ModuleContext) {}

  private get commissionBps(): number {
    return Math.max(0, this.ctx.config.fees.hostingCommissionBps ?? 0);
  }

  /** Where the platform commission goes — the treasury, or an explicit network-wide founder wallet. */
  private get commissionAddress(): Web3Id {
    return (process.env.WEB3_COMMISSION_ADDRESS || this.ctx.treasuryId) as Web3Id;
  }

  async getOffer(): Promise<HostingOffer | null> {
    return (await this.ctx.store.loadSetting<HostingOffer>(OFFER_KEY)) ?? null;
  }

  /** Publish (or update) this host's per-epoch price. `host` is the operator's account address. */
  async setOffer(host: Web3Id, pricePerEpoch: number): Promise<HostingOffer> {
    const offer: HostingOffer = {
      host,
      pricePerEpoch: Math.max(0, Math.floor(pricePerEpoch)),
      updatedAt: this.ctx.clock(),
    };
    await this.ctx.store.saveSetting(OFFER_KEY, offer);
    return offer;
  }

  private async loadLeases(): Promise<Lease[]> {
    return (await this.ctx.store.loadSetting<Lease[]>(LEASES_KEY)) ?? [];
  }

  private async saveLeases(leases: Lease[]): Promise<void> {
    await this.ctx.store.saveSetting(LEASES_KEY, leases);
  }

  /** This node's derived hosting capacity (max agents) from the operator's contributed RAM. */
  private async capacity(): Promise<number> {
    const limits = await this.ctx.store.loadSetting<{ maxAgents?: number; maxRamMb?: number }>(
      'node-limits',
    );
    if (limits?.maxAgents && limits.maxAgents > 0) return limits.maxAgents;
    const perAgent = Math.max(1, this.ctx.config.ramMbPerAgent);
    return limits?.maxRamMb && limits.maxRamMb > 0 ? Math.floor(limits.maxRamMb / perAgent) : 0;
  }

  /** The marketplace as this node sees it: the local host's offer + its live free capacity. */
  async market(): Promise<
    Array<{ host: Web3Id; pricePerEpoch: number; capacity: number; used: number; free: number }>
  > {
    const offer = await this.getOffer();
    if (!offer || offer.pricePerEpoch <= 0) return [];
    const capacity = await this.capacity();
    const used = (await this.loadLeases()).filter((l) => l.active && l.host === offer.host).length;
    return [
      {
        host: offer.host,
        pricePerEpoch: offer.pricePerEpoch,
        capacity,
        used,
        free: Math.max(0, capacity - used),
      },
    ];
  }

  /** Rent this host to run `agentId` for `owner`. Rejects if there's no offer or no free capacity. */
  async rent(owner: Web3Id, agentId: Web3Id): Promise<Lease> {
    const offer = await this.getOffer();
    if (!offer || offer.pricePerEpoch <= 0) throw new Error('this host is not offering capacity');
    if (owner === offer.host) throw new Error('a host cannot rent its own capacity');
    const leases = await this.loadLeases();
    if (leases.some((l) => l.active && l.agentId === agentId)) {
      throw new Error(`${agentId} is already hosted`);
    }
    const capacity = await this.capacity();
    const used = leases.filter((l) => l.active && l.host === offer.host).length;
    if (capacity > 0 && used >= capacity) throw new Error('host is at capacity');
    const lease: Lease = {
      id: `lease_${randomUUID()}`,
      owner,
      host: offer.host,
      agentId,
      pricePerEpoch: offer.pricePerEpoch,
      active: true,
      createdAt: this.ctx.clock(),
      epochsBilled: 0,
      paidTotal: 0,
    };
    leases.push(lease);
    await this.saveLeases(leases);
    return lease;
  }

  /** End a lease (owner or host). No refund of already-billed epochs. */
  async endLease(id: string): Promise<boolean> {
    const leases = await this.loadLeases();
    const lease = leases.find((l) => l.id === id);
    if (!lease || !lease.active) return false;
    lease.active = false;
    await this.saveLeases(leases);
    return true;
  }

  /** Leases visible to `who`, either as owner or host (all when `who` is omitted, e.g. admin). */
  async leasesFor(who?: Web3Id): Promise<Lease[]> {
    const leases = await this.loadLeases();
    return who ? leases.filter((l) => l.owner === who || l.host === who) : leases;
  }

  /** Net hosting revenue earned by `host` across all its leases. */
  async revenueFor(host: Web3Id): Promise<number> {
    const rate = 1 - this.commissionBps / 10_000;
    return (await this.loadLeases())
      .filter((l) => l.host === host)
      .reduce((sum, l) => sum + Math.round(l.paidTotal * rate), 0);
  }

  /**
   * Charge every active lease one epoch's price. For each: the owner pays `pricePerEpoch`, split into
   * the platform commission (to the treasury) and the net to the host. A lease whose owner can't
   * cover the charge is skipped this epoch (it stays active and is retried next epoch). Returns the
   * receipts for the charges that settled.
   */
  async billEpoch(): Promise<HostingReceipt[]> {
    const leases = await this.loadLeases();
    const receipts: HostingReceipt[] = [];
    let mutated = false;
    for (const lease of leases) {
      if (!lease.active || lease.pricePerEpoch <= 0) continue;
      const gross = lease.pricePerEpoch;
      if (this.ctx.ledger.balanceOf(lease.owner) < gross) continue; // insufficient funds → retry next epoch
      const commission = Math.floor((gross * this.commissionBps) / 10_000);
      const net = gross - commission;
      this.ctx.ledger.transfer(lease.owner, lease.host, net, { memo: 'hosting-fee' });
      if (commission > 0) {
        this.ctx.ledger.transfer(lease.owner, this.commissionAddress, commission, {
          memo: 'hosting-commission',
        });
      }
      lease.epochsBilled += 1;
      lease.paidTotal += gross;
      mutated = true;
      receipts.push({
        leaseId: lease.id,
        owner: lease.owner,
        host: lease.host,
        gross,
        commission,
        net,
      });
      this.ctx.bus.emit({
        kind: 'hosting.billed',
        actor: lease.owner,
        target: lease.host,
        summary: `hosting fee ${net} to ${lease.host} (+${commission} commission) for ${lease.agentId}`,
        data: { leaseId: lease.id, gross, commission, net },
      });
    }
    if (mutated) await this.saveLeases(leases);
    return receipts;
  }
}
