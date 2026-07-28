import type { Web3Id } from '@web3/core';
import type { ModuleContext, Web3Module } from '../context.js';
import { currentAccount, hasRole, requireAuthed, requireRole } from '../services/auth.js';
import { HostingService } from '../services/hosting.js';

/**
 * hosting — the compute-marketplace API. A host publishes a per-epoch price (`POST /hosting/offer`);
 * an agent-owner browses `GET /hosting/market` and rents capacity for one of their agents
 * (`POST /hosting/rent`), creating a lease that's billed each epoch — the host earns the fee minus the
 * platform commission. Billing runs automatically on an epoch timer and can be triggered manually.
 */
export function hostingModule(): Web3Module {
  return {
    name: 'hosting',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http } = ctx;
      const svc = new HostingService(ctx);

      // Per-epoch billing tick — bill this node's OWN leases every epoch. Unref'd so it never keeps a
      // process (or a test run) alive; also exposed via POST /hosting/bill for ops/testing.
      const epochMs = Math.max(1, ctx.config.fees.epochBlocks) * ctx.config.consensus.blockMs;
      const timer = setInterval(() => {
        void svc.billEpoch().catch((err) => ctx.log.warn({ err }, 'hosting: epoch billing failed'));
      }, epochMs);
      timer.unref?.();

      // Host publishes/updates its per-epoch price. `host` is the signed-in operator's own address.
      http.post('/hosting/offer', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in first' });
        const price = Number((request.body as { pricePerEpoch?: unknown })?.pricePerEpoch);
        if (!Number.isFinite(price) || price < 0) {
          return reply.code(400).send({ error: 'pricePerEpoch must be a number >= 0' });
        }
        return svc.setOffer(acct.address as Web3Id, price);
      });

      http.get(
        '/hosting/offer',
        async () => (await svc.getOffer()) ?? { host: null, pricePerEpoch: 0 },
      );

      // The marketplace an agent-owner browses: hosts, their price, and live free capacity.
      http.get('/hosting/market', async () => ({ hosts: await svc.market() }));

      // Agent-owner rents this host to run one of their agents.
      http.post('/hosting/rent', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in first' });
        const agentId = String((request.body as { agentId?: unknown })?.agentId ?? '').trim();
        if (!agentId) return reply.code(400).send({ error: 'agentId is required' });
        try {
          return await svc.rent(acct.address as Web3Id, agentId as Web3Id);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      // End a lease — the owner or host of that lease, or an admin.
      http.post('/hosting/lease/:id/end', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in first' });
        const id = (request.params as { id: string }).id;
        const isAdmin = hasRole(request, ctx.accounts, 'admin');
        const mine = await svc.leasesFor(acct.address as Web3Id);
        if (!isAdmin && !mine.some((l) => l.id === id)) {
          return reply.code(403).send({ error: 'not your lease' });
        }
        return { ended: await svc.endLease(id) };
      });

      // A caller's leases (as owner or host); an admin sees all.
      http.get('/hosting/leases', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        const isAdmin = hasRole(request, ctx.accounts, 'admin');
        return { leases: await svc.leasesFor(isAdmin ? undefined : (acct?.address as Web3Id)) };
      });

      // The signed-in host's net hosting revenue.
      http.get('/hosting/revenue', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in first' });
        return { host: acct.address, revenue: await svc.revenueFor(acct.address as Web3Id) };
      });

      // Manual billing trigger (admin) — the same charge the epoch timer runs.
      http.post('/hosting/bill', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        return { receipts: await svc.billEpoch() };
      });
    },
  };
}
