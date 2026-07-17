import type { AcpEvent } from '@acp/core';
import { randomId } from '@acp/crypto';

type Listener = (event: AcpEvent) => void;

/**
 * The observability backbone. Every module publishes activity here; the dashboard reads the
 * recent ring buffer and subscribes for live updates. Deliberately in-memory for the MVP.
 */
export class EventBus {
  private readonly buffer: AcpEvent[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly clock: () => string,
    private readonly capacity = 1000,
  ) {}

  emit(event: Omit<AcpEvent, 'id' | 'ts'>): AcpEvent {
    const full: AcpEvent = { id: randomId('evt'), ts: this.clock(), ...event };
    this.buffer.push(full);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    for (const listener of this.listeners) listener(full);
    return full;
  }

  recent(limit = 100): AcpEvent[] {
    return this.buffer.slice(-limit).reverse();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
