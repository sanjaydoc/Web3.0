import type { Web3Id } from '@acp/core';
import type { WebSocket } from 'ws';

/**
 * Tracks live agent WebSocket connections and routes messages to them. If a recipient is
 * offline, messages queue in memory and flush when it reconnects — so an agent doesn't need a
 * 24/7 VPS to receive work (a first step toward ACP's "no VPS required" goal).
 */
export class ConnectionHub {
  private readonly sockets = new Map<Web3Id, WebSocket>();
  private readonly queues = new Map<Web3Id, unknown[]>();

  bind(web3Id: Web3Id, socket: WebSocket): void {
    this.sockets.set(web3Id, socket);
  }

  unbind(web3Id: Web3Id): void {
    this.sockets.delete(web3Id);
  }

  isOnline(web3Id: Web3Id): boolean {
    return this.sockets.has(web3Id);
  }

  online(): Web3Id[] {
    return [...this.sockets.keys()];
  }

  /** Deliver a JSON-serialisable message to an agent, queueing it if the agent is offline. */
  sendTo(web3Id: Web3Id, message: unknown): 'delivered' | 'queued' {
    const socket = this.sockets.get(web3Id);
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
      return 'delivered';
    }
    const queue = this.queues.get(web3Id) ?? [];
    queue.push(message);
    this.queues.set(web3Id, queue);
    return 'queued';
  }

  /** Flush any queued messages to a freshly-connected agent. */
  drain(web3Id: Web3Id): number {
    const queue = this.queues.get(web3Id);
    const socket = this.sockets.get(web3Id);
    if (!queue || !socket || socket.readyState !== socket.OPEN) return 0;
    for (const message of queue) socket.send(JSON.stringify(message));
    this.queues.delete(web3Id);
    return queue.length;
  }
}
