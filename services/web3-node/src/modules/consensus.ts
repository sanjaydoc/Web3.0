import type { Block } from '@web3/consensus';
import type { SignedTx } from '@web3/core';
import WebSocket from 'ws';
import type { WebSocket as WsSocket } from 'ws';
import type { ModuleContext, Web3Module } from '../context.js';

/**
 * consensus — the distributed L1 surface. Always exposes `GET /consensus` (status). When
 * `WEB3_CONSENSUS=poa`, it also:
 *   - proposes a block from this node's new ledger entries on its turn (every `blockMs`),
 *   - gossips proposed blocks to connected peers over the `/consensus/peer` WebSocket,
 *   - dials configured peers and applies the blocks they gossip.
 *
 * Blocks form a replicated, authority-signed ordered log; see ConsensusCoordinator for scope.
 */
export function consensusModule(): Web3Module {
  return {
    name: 'consensus',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, consensus, config, log, bus } = ctx;
      const subscribers = new Set<WsSocket>();
      const dialed = new Set<WebSocket>();
      let closing = false;

      http.get('/consensus', () => consensus.status());

      if (!consensus.enabled) return;

      const sendAll = (frame: string): void => {
        for (const s of subscribers) if (s.readyState === s.OPEN) s.send(frame);
        for (const s of dialed) if (s.readyState === WebSocket.OPEN) s.send(frame);
      };
      const broadcast = (block: Block): void => sendAll(JSON.stringify({ kind: 'block', block }));
      const broadcastTx = (tx: SignedTx): void => sendAll(JSON.stringify({ kind: 'tx', tx }));

      // Let the coordinator gossip locally-submitted txs (via POST /tx) out to the mesh.
      consensus.broadcastTx = broadcastTx;

      const onInbound = (raw: unknown, gossip: boolean): void => {
        let frame: { kind?: string; block?: Block; tx?: SignedTx };
        try {
          frame = JSON.parse(String(raw));
        } catch {
          return;
        }
        // A forwarded account-signed transaction. Validate + queue it; if it's genuinely new,
        // re-gossip so it keeps flowing toward an authority through relays (dedupe stops loops).
        if (frame.kind === 'tx' && frame.tx) {
          const res = consensus.acceptTx(frame.tx);
          if (res.ok && !res.duplicate && gossip) broadcastTx(frame.tx);
          return;
        }
        if (frame.kind !== 'block' || !frame.block) return;
        const result = consensus.ingest(frame.block);
        if (result.slashed) {
          bus.emit({
            kind: 'authority.slashed',
            summary: `authority ${result.slashed.slice(0, 16)}… slashed for double-signing — stake burned, removed from the set`,
          });
        }
        // Re-gossip only genuinely new, valid blocks so the mesh converges without loops.
        if (result.ok && gossip && frame.block.height === consensus.engine!.height - 1) {
          broadcast(frame.block);
        }
      };

      // Send our whole chain to a peer so it can catch up on blocks proposed before it connected.
      const syncTo = (send: (frame: string) => void): void => {
        for (const block of consensus.engine!.blocks)
          send(JSON.stringify({ kind: 'block', block }));
      };

      // Inbound peers subscribe here to receive our blocks and push theirs.
      http.get('/consensus/peer', { websocket: true }, (socket: WsSocket) => {
        subscribers.add(socket);
        syncTo((frame) => socket.send(frame)); // catch the new peer up to our current head
        socket.on('message', (raw) => onInbound(raw, true));
        socket.on('close', () => subscribers.delete(socket));
      });

      // Dial configured peers so we receive their blocks too. Reconnect on drop so the mesh
      // self-heals regardless of node boot order or transient outages.
      const dial = (url: string): void => {
        if (closing) return;
        const ws = new WebSocket(url);
        dialed.add(ws);
        ws.on('message', (raw) => onInbound(raw, false));
        ws.on('close', () => {
          dialed.delete(ws);
          if (!closing) setTimeout(() => dial(url), 1_000).unref?.();
        });
        ws.on('error', () => {
          /* peer offline — 'close' fires next and schedules a retry */
        });
      };
      for (const peer of config.consensus.peers) {
        dial(`${peer.replace(/^http/, 'ws').replace(/\/$/, '')}/consensus/peer`);
      }

      // Propose on our turn, on an interval. Blocks batch this node's new ledger entries.
      const timer = setInterval(() => {
        const block = consensus.proposeTick();
        if (block) {
          log.info(`consensus: proposed block #${block.height} (${block.entries.length} entries)`);
          broadcast(block);
        }
      }, config.consensus.blockMs);
      if (typeof timer.unref === 'function') timer.unref();

      http.addHook('onClose', async () => {
        closing = true;
        clearInterval(timer);
        for (const s of dialed) s.close();
      });

      log.info(
        `consensus: PoA active · ${consensus.status().authorities.length} authorities · ${config.consensus.peers.length} peers`,
      );
    },
  };
}
