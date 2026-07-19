import type { Web3Event } from '@web3/core';
import { randomId } from '@web3/crypto';

type Listener = (event: Web3Event) => void;

/**
 * The observability backbone. Every module publishes activity here; the dashboard reads the
 * recent ring buffer and subscribes for live updates. Deliberately in-memory for the MVP.
 */
export class EventBus {
  private readonly buffer: Web3Event[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly clock: () => string,
    private readonly capacity = 1000,
  ) {}

  emit(event: Omit<Web3Event, 'id' | 'ts'>): Web3Event {
    const full: Web3Event = { id: randomId('evt'), ts: this.clock(), ...event };
    this.buffer.push(full);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    for (const listener of this.listeners) listener(full);
    return full;
  }

  recent(limit = 100): Web3Event[] {
    return this.buffer.slice(-limit).reverse();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
