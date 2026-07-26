import { type Web3Id, formatAmount } from '@web3/core';
import type { ModuleContext, Web3Module } from '../context.js';
import { BURN_ID } from '../services/economics.js';

/**
 * observability — the read side that powers the dashboard. Exposes the live event feed (recent
 * buffer + a Server-Sent-Events stream), the ledger with its verification status, and summary
 * stats. Web3.0's answer to "no observability".
 */
export function observabilityModule(): Web3Module {
  return {
    name: 'observability',
    version: '0.1.0',
    register({
      http,
      bus,
      ledger,
      registry,
      connections,
      contribution,
      treasuryId,
    }: ModuleContext) {
      // The node treasury is registered as an agent card (so it has an identity + wallet) but it is
      // infrastructure, not a real agent — never count it among "agents". Each node's heartbeat also
      // excludes it, so the network-wide sum is real agents only.
      const localAgents = (): number =>
        registry.size - (registry.has(treasuryId as Web3Id) ? 1 : 0);
      http.get('/events', (request) => {
        const { limit } = request.query as { limit?: string };
        return { events: bus.recent(limit ? Number(limit) : 100) };
      });

      // Live event stream over Server-Sent Events.
      http.get('/events/stream', (request, reply) => {
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        reply.raw.write(
          `event: hello\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`,
        );
        const unsubscribe = bus.subscribe((event) => {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        request.raw.on('close', unsubscribe);
      });

      http.get('/ledger', (request) => {
        const { limit } = request.query as { limit?: string };
        const entries = ledger.all();
        const recent = entries.slice(-(limit ? Number(limit) : 50)).reverse();
        return {
          size: ledger.size,
          head: ledger.head(),
          verify: ledger.verifyChainCached(),
          wallets: ledger.wallets(),
          entries: recent,
        };
      });

      http.get('/stats', () => {
        const wallets = ledger.wallets();
        // Burned aETH has left circulation — it is not "value in network".
        const burned = wallets.find((w) => w.owner === BURN_ID)?.balance ?? 0;
        const totalValue = wallets.reduce((sum, w) => sum + w.balance, 0) - burned;
        // Network-wide agent counts: when this node is in a consensus network it hears a signed
        // heartbeat from every live node (including itself), so summing each node's advertised
        // `agentsHosted` / online figure gives the whole network's totals — an agent spun up on ANY
        // operator's node then shows in the admin's Overview / Network. A solo node (no consensus,
        // so no heartbeats) falls back to its own local counts.
        const networked = contribution.size > 0;
        return {
          agents: networked ? contribution.totalAgents() : localAgents(),
          online: networked ? contribution.totalOnline() : connections.online().length,
          // Live NODES in the network (peers heard from via a fresh signed contribution heartbeat,
          // within the freshness window) — distinct from `online`, which counts connected agents.
          // A running desktop peer shows up here even though it hosts no agents.
          nodes: contribution.size,
          ledgerEntries: ledger.size,
          ledgerVerified: ledger.verifyChainCached().ok,
          totalValue,
          totalValueFormatted: formatAmount(totalValue),
          burned,
          burnedFormatted: formatAmount(burned),
        };
      });
    },
  };
}
