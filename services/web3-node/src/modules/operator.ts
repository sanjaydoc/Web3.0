import os from 'node:os';
import { formatAmount } from '@web3/core';
import type { Web3Id } from '@web3/core';
import type { AcpModule, ModuleContext } from '../context.js';
import { checkAdmin } from '../services/admin.js';

export interface NodeLimits {
  /** Whether this node offers spare compute to host others' agents. */
  contribute: boolean;
  /** RAM (MB) the operator is willing to contribute (0 = no cap). */
  maxRamMb: number;
  /** Max agents this node will host (0 = no cap). */
  maxAgents: number;
}

const DEFAULT_LIMITS: NodeLimits = { contribute: true, maxRamMb: 0, maxAgents: 0 };
export const LIMITS_KEY = 'node-limits';

/**
 * operator — the "my node" console for whoever runs the node: live earnings (treasury balance,
 * fees vs block rewards), traffic, resource usage (RAM, uptime), and the resources they choose to
 * contribute. Read endpoints are open; changing limits is admin-gated.
 */
export function operatorModule(): AcpModule {
  return {
    name: 'operator',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, ledger, registry, connections, consensus, settlement, config, treasuryId } =
        ctx;

      const earnings = () => {
        let fees = 0;
        let rewards = 0;
        for (const e of ledger.all()) {
          if (e.type !== 'payment') continue;
          const d = e.data as { to: Web3Id; from: Web3Id | null; amount: number; memo?: string };
          if (d.to !== treasuryId) continue;
          if (d.from === null) rewards += d.amount;
          else if (d.memo === 'protocol-fee') fees += d.amount;
        }
        const balance = ledger.balanceOf(treasuryId as Web3Id);
        return { balance, fees, rewards, formatted: formatAmount(balance) };
      };

      const resources = () => {
        const mem = process.memoryUsage();
        return {
          uptimeSec: Math.floor((Date.now() - ctx.startedAt) / 1000),
          processRssMb: Math.round(mem.rss / 1048576),
          heapUsedMb: Math.round(mem.heapUsed / 1048576),
          systemTotalMb: Math.round(os.totalmem() / 1048576),
          systemFreeMb: Math.round(os.freemem() / 1048576),
          cpus: os.cpus().length,
          loadAvg1: Number((os.loadavg()[0] ?? 0).toFixed(2)),
        };
      };

      http.get('/node', async () => {
        const limits = (await ctx.store.loadSetting<NodeLimits>(LIMITS_KEY)) ?? DEFAULT_LIMITS;
        const status = consensus.status();
        return {
          nodePublicKey: status.authority || undefined,
          treasuryId,
          uptimeSec: resources().uptimeSec,
          earnings: earnings(),
          traffic: {
            agents: registry.size,
            online: connections.online().length,
            ledgerEntries: ledger.size,
          },
          consensus: {
            mode: status.mode,
            authorities: status.authorities.length,
            height: status.height,
            peers: status.peers.length,
            isMyTurn: status.isMyTurn,
          },
          settlement: { mode: config.settlement.mode, network: settlement.network },
          resources: resources(),
          limits,
        };
      });

      http.post('/node/limits', async (request, reply) => {
        if (!checkAdmin(request, reply)) return;
        const body = (request.body ?? {}) as Partial<NodeLimits>;
        const current = (await ctx.store.loadSetting<NodeLimits>(LIMITS_KEY)) ?? DEFAULT_LIMITS;
        const next: NodeLimits = {
          contribute: typeof body.contribute === 'boolean' ? body.contribute : current.contribute,
          maxRamMb: Number.isFinite(body.maxRamMb)
            ? Math.max(0, Number(body.maxRamMb))
            : current.maxRamMb,
          maxAgents: Number.isFinite(body.maxAgents)
            ? Math.max(0, Number(body.maxAgents))
            : current.maxAgents,
        };
        await ctx.store.saveSetting(LIMITS_KEY, next);
        return next;
      });
    },
  };
}
