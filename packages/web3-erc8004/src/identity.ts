import type { AgentRegistration, Erc8004Event } from './types.js';
import { deriveAgentAddress, normAddr } from './util.js';

export interface NewAgentParams {
  /** The controlling address. If omitted, derived deterministically from `did`/`web3Id`. */
  owner?: string;
  agentAddress?: string;
  /** The agent's domain / handle — unique within the registry. */
  agentDomain: string;
  web3Id?: string;
  did?: string;
  /** URI of the registration file. If omitted, the module fills a default. */
  tokenURI?: string;
}

/**
 * The Identity Registry — an ERC-721-style directory of agents. Each agent is a token (`agentId`)
 * owned by a controlling address and resolving to a registration file. This is the anchor the
 * Reputation and Validation registries defer to for authorization: they ask "does this agent exist,
 * and is the caller allowed to act for it?" before accepting a write.
 *
 * Ledger-backed and in-memory (parity with Web3.0's base `Registry`); resolution semantics match the
 * on-chain standard. Idempotent by `agentDomain` so backfilling existing agents is safe.
 */
export class IdentityRegistry {
  private readonly byId = new Map<number, AgentRegistration>();
  private readonly byAddress = new Map<string, number>();
  private readonly byDomain = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly clock: () => string,
    private readonly emit?: (e: Erc8004Event) => void,
  ) {}

  /** Register a new agent (or return the existing record for a known domain). */
  newAgent(params: NewAgentParams): AgentRegistration {
    const existing = this.byDomain.get(params.agentDomain);
    if (existing !== undefined) return this.byId.get(existing) as AgentRegistration;

    const seed = params.did ?? params.web3Id ?? params.agentDomain;
    const agentAddress = normAddr(params.agentAddress ?? params.owner ?? deriveAgentAddress(seed));
    const owner = normAddr(params.owner ?? agentAddress);
    const now = this.clock();
    const agentId = ++this.seq;
    const reg: AgentRegistration = {
      agentId,
      owner,
      agentAddress,
      agentDomain: params.agentDomain,
      web3Id: params.web3Id,
      did: params.did,
      tokenURI: params.tokenURI ?? `web3://agent/${agentId}`,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(agentId, reg);
    this.byDomain.set(reg.agentDomain, agentId);
    this.byAddress.set(agentAddress, agentId);
    this.emit?.({
      kind: 'identity.registered',
      agentId,
      agentAddress,
      agentDomain: reg.agentDomain,
    });
    return reg;
  }

  getAgent(agentId: number): AgentRegistration | undefined {
    return this.byId.get(agentId);
  }

  ownerOf(agentId: number): string | undefined {
    return this.byId.get(agentId)?.owner;
  }

  resolveByAddress(address: string): AgentRegistration | undefined {
    const id = this.byAddress.get(normAddr(address));
    return id !== undefined ? this.byId.get(id) : undefined;
  }

  resolveByDomain(domain: string): AgentRegistration | undefined {
    const id = this.byDomain.get(domain);
    return id !== undefined ? this.byId.get(id) : undefined;
  }

  /** Update mutable fields (tokenURI, agentAddress). Only the owner may (checked by the caller). */
  updateAgent(
    agentId: number,
    patch: { tokenURI?: string; agentAddress?: string },
  ): AgentRegistration | undefined {
    const reg = this.byId.get(agentId);
    if (!reg) return undefined;
    if (patch.agentAddress) {
      this.byAddress.delete(reg.agentAddress);
      reg.agentAddress = normAddr(patch.agentAddress);
      this.byAddress.set(reg.agentAddress, agentId);
    }
    if (patch.tokenURI) reg.tokenURI = patch.tokenURI;
    reg.updatedAt = this.clock();
    return reg;
  }

  /** Transfer the agent NFT to a new owner (ERC-721 semantics). */
  transfer(agentId: number, newOwner: string): AgentRegistration | undefined {
    const reg = this.byId.get(agentId);
    if (!reg) return undefined;
    const from = reg.owner;
    reg.owner = normAddr(newOwner);
    reg.updatedAt = this.clock();
    this.emit?.({ kind: 'identity.transferred', agentId, from, to: reg.owner });
    return reg;
  }

  list(): AgentRegistration[] {
    return [...this.byId.values()];
  }

  get size(): number {
    return this.byId.size;
  }
}
