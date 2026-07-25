import { formatAmount } from '@web3/core';
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
    register({ http, bus, ledger, registry, connections }: ModuleContext) {
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
        return {
          agents: registry.size,
          online: connections.online().length,
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
