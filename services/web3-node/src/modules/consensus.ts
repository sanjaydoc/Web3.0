import type { Block } from '@web3/consensus';
import type { SignedTx } from '@web3/core';
import WebSocket from 'ws';
import type { WebSocket as WsSocket } from 'ws';
import type { ModuleContext, Web3Module } from '../context.js';
import type { ContributionReport, Heartbeat } from '../services/contribution.js';
import { LOCATIONS_KEY, type NodeLocation } from './operator.js';

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
      const { http, consensus, config, log, bus, ledger, registry, connections } = ctx;
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
      const broadcastHeartbeat = (hb: Heartbeat): void =>
        sendAll(JSON.stringify({ kind: 'heartbeat', hb }));

      // Let the coordinator gossip locally-submitted txs (via POST /tx) out to the mesh, and let it
      // push this node's own contribution heartbeat.
      consensus.broadcastTx = broadcastTx;
      consensus.broadcastHeartbeat = broadcastHeartbeat;

      const onInbound = (raw: unknown, gossip: boolean): void => {
        let frame: { kind?: string; block?: Block; tx?: SignedTx; hb?: Heartbeat };
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
        // A peer's Proof-of-Contribution heartbeat. Verify + register it; re-gossip only if it was
        // new (newer than what we held), so the mesh converges on live contributors without loops.
        if (frame.kind === 'heartbeat' && frame.hb) {
          const fresh = consensus.ingestHeartbeat(frame.hb);
          if (fresh && gossip) broadcastHeartbeat(frame.hb);
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
      const proposeAndBroadcast = async (): Promise<void> => {
        const block = consensus.proposeTick();
        if (!block) return;
        // Durability boundary: the block's entries (including the reward mint) must be on disk
        // before we announce the block to peers. Awaiting the write here is what makes a committed
        // block crash-safe — a node that dies right after broadcasting can't come back with a
        // persisted seq-gap, because the write already landed.
        try {
          await ledger.flush();
        } catch (err) {
          log.error({ err }, 'consensus: not broadcasting block — ledger persistence failed');
          return;
        }
        log.info(`consensus: proposed block #${block.height} (${block.entries.length} entries)`);
        broadcast(block);
      };
      const timer = setInterval(() => void proposeAndBroadcast(), config.consensus.blockMs);
      if (typeof timer.unref === 'function') timer.unref();

      // Proof-of-Contribution: periodically publish this node's live contribution (uptime, hosted
      // agents, connected agents relayed) as a signed heartbeat. We register our own report locally
      // too, so a proposing authority always counts itself, then gossip it to peers.
      const emitHeartbeat = async (): Promise<void> => {
        // Advertise this node's opt-in location (the operator's most-recently-saved position) so it
        // shows on every peer's map, not just locally. Single-operator nodes have exactly one entry;
        // absent → the report simply carries no location.
        const locs = (await ctx.store.loadSetting<NodeLocation[]>(LOCATIONS_KEY)) ?? [];
        const loc = [...locs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
        const report: ContributionReport = {
          nodeKey: ctx.nodePublicKey,
          uptimeSec: Math.floor((Date.now() - ctx.startedAt) / 1000),
          // registry.size includes this node's treasury card (infrastructure, not a real agent). We
          // keep it in the raw heartbeat for cross-version consistency — EVERY node reports one
          // treasury — and the aggregator (`/stats`) subtracts exactly one treasury per live node.
          // This stays correct even while nodes run mixed versions during a rollout.
          agentsHosted: registry.size,
          txServed: connections.online().length,
          ts: Date.now(),
          ...(loc ? { lat: loc.lat, lon: loc.lon, label: loc.label } : {}),
        };
        const hb = consensus.signContribution(report);
        consensus.ingestHeartbeat(hb);
        broadcastHeartbeat(hb);
      };
      void emitHeartbeat(); // announce ourselves immediately on boot
      const heartbeatMs = Math.max(config.consensus.blockMs, 15_000);
      const hbTimer = setInterval(() => void emitHeartbeat(), heartbeatMs);
      if (typeof hbTimer.unref === 'function') hbTimer.unref();

      http.addHook('onClose', async () => {
        closing = true;
        clearInterval(timer);
        clearInterval(hbTimer);
        for (const s of dialed) s.close();
      });

      log.info(
        `consensus: PoA active · ${consensus.status().authorities.length} authorities · ${config.consensus.peers.length} peers`,
      );
    },
  };
}
