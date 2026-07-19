import type { AgentCard, Web3Id } from '@web3/core';

/** The in-memory directory of who exists on the network and what they can do. */
export class Registry {
  private readonly cards = new Map<Web3Id, AgentCard>();

  has(web3Id: Web3Id): boolean {
    return this.cards.has(web3Id);
  }

  get(web3Id: Web3Id): AgentCard | undefined {
    return this.cards.get(web3Id);
  }

  add(card: AgentCard): void {
    this.cards.set(card.web3Id, card);
  }

  list(): AgentCard[] {
    return [...this.cards.values()];
  }

  get size(): number {
    return this.cards.size;
  }
}
