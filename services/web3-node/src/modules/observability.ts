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
      // infrastructure, not a real agent — never count it among "agents". Every node has EXACTLY one
      // treasury (ensureTreasury), so real agents = registry.size − 1 locally, and network-wide =
      // (sum of every node's agentsHosted) − (one treasury per live node). Doing the subtraction on
      // the aggregator keeps the count correct even while nodes run mixed versions.
      const localAgents = (): number =>
        Math.max(0, registry.size - (registry.has(treasuryId as Web3Id) ? 1 : 0));
      const networkAgents = (): number =>
        Math.max(0, contribution.totalAgents() - contribution.size);
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
        const { limit, account } = request.query as { limit?: string; account?: string };
        // A node operator passes ?account=<their address> to get ONLY their own transactions, drawn
        // from the FULL replicated chain (history), so their ledger stays populated across restarts:
        // a follower authors nothing into its own log, so `all()` alone is empty after a re-sync —
        // the operator's sealed payments live on the chain and arrive as replicated entries.
        const rows = account
          ? ledger.historyFor(account as Parameters<typeof ledger.historyFor>[0])
          : ledger.history();
        const recent = rows.slice(-(limit ? Number(limit) : account ? 500 : 50)).reverse();
        return {
          size: rows.length,
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
        // Total agents ever registered on THIS node's ledger — the append-only `register` entries
        // (idle/offline agents still count), treasury excluded. On a solo node this is the whole
        // picture; when networked we instead sum every live node's own cumulative count (carried in
        // its heartbeat as `agentsTotal`) so "Total agents" reflects the WHOLE network — an agent
        // created on any operator's node shows in the admin's Overview, exactly like the live `agents`
        // figure. Only live nodes contribute (persistent cross-node totals need agent-card replication).
        const localTotalAgents = ledger
          .all()
          .filter(
            (e) => e.type === 'register' && (e.data as { web3Id?: string }).web3Id !== treasuryId,
          ).length;
        return {
          agents: networked ? networkAgents() : localAgents(),
          online: networked ? contribution.totalOnline() : connections.online().length,
          // Live NODES in the network (peers heard from via a fresh signed contribution heartbeat,
          // within the freshness window) — distinct from `online`, which counts connected agents.
          // A running desktop peer shows up here even though it hosts no agents.
          nodes: contribution.size,
          // Cumulative agents ever created across the network (idle + online), treasury excluded.
          totalAgents: networked ? contribution.totalAgentsEver() : localTotalAgents,
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
