import os from 'node:os';
import { formatAmount } from '@web3/core';
import type { Web3Id } from '@web3/core';
import type { ModuleContext, Web3Module } from '../context.js';
import { checkAdmin } from '../services/admin.js';
import { currentAccount, requireAuthed } from '../services/auth.js';

/** An operator's self-reported node position, shown on the Network map. Opt-in only. */
export interface NodeLocation {
  address: string; // account that set it (one location per account)
  label: string; // display name, e.g. "Chennai"
  lat: number;
  lon: number;
  updatedAt: string;
}

export const LOCATIONS_KEY = 'node-locations';

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
export function operatorModule(): Web3Module {
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

      // --- operator locations (the Network map's real geography) -----------------------------
      const loadLocations = async () =>
        (await ctx.store.loadSetting<NodeLocation[]>(LOCATIONS_KEY)) ?? [];

      // Public: every opt-in operator position (this is what the map renders).
      http.get('/operator/locations', async () => ({ locations: await loadLocations() }));

      // Signed-in operators set (or update) their own position. Coordinates are rounded to 4 dp
      // (~11 m) and only what is explicitly saved here is ever shared.
      http.put('/operator/location', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in to set a node location' });
        const body = (request.body ?? {}) as { lat?: number; lon?: number; label?: string };
        const lat = Number(body.lat);
        const lon = Number(body.lon);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          return reply.code(400).send({ error: 'lat must be a number in [-90, 90]' });
        }
        if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
          return reply.code(400).send({ error: 'lon must be a number in [-180, 180]' });
        }
        const loc: NodeLocation = {
          address: acct.address,
          label: String(body.label ?? '')
            .trim()
            .slice(0, 48),
          lat: Math.round(lat * 10000) / 10000,
          lon: Math.round(lon * 10000) / 10000,
          updatedAt: new Date().toISOString(),
        };
        const rest = (await loadLocations()).filter((l) => l.address !== acct.address);
        await ctx.store.saveSetting(LOCATIONS_KEY, [...rest, loc]);
        return loc;
      });

      // Remove your own position from the map.
      http.delete('/operator/location', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in first' });
        const rest = (await loadLocations()).filter((l) => l.address !== acct.address);
        await ctx.store.saveSetting(LOCATIONS_KEY, rest);
        return { removed: true };
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
