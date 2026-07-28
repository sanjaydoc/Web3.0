import type { ModuleContext, Web3Module } from '../context.js';
import { adminRequired } from '../services/admin.js';
import { currentAccount, requireParticipation } from '../services/auth.js';
import { type HostedAgentConfig, HostedAgentService } from '../services/hosted.js';

/**
 * hosted — launch and run Genesis agents inside the node (the GUI "no-VPS host"). Management
 * endpoints are admin-gated; the read-only list is open so the dashboard can show what's running.
 */
export function hostedModule(): Web3Module {
  return {
    name: 'hosted',
    version: '0.1.0',
    async register(ctx: ModuleContext) {
      const svc = new HostedAgentService(ctx);
      await svc.load(); // relaunch persisted hosted agents

      ctx.http.get('/hosted', (request) => {
        const acct = currentAccount(request, ctx.accounts);
        const all = svc.status();
        // A signed-in non-admin (node operator) sees only the dApps they created; admins/open see all.
        const scoped = acct !== null && acct.role !== 'admin';
        const agents = scoped
          ? all.filter((a) => a.createdBy.toLowerCase() === acct.address.toLowerCase())
          : all;
        return { agents, adminRequired: adminRequired(), scopedTo: scoped ? acct.address : null };
      });

      ctx.http.post('/hosted/launch', async (request, reply) => {
        // Any signed-in account may launch — except on an admin-only node (the network's main node),
        // where hosting is reserved for the admin so operators run agents on their OWN node instead.
        if (!requireParticipation(request, reply, ctx.accounts, ctx.config.adminOnly)) return;
        // The publishing account's address becomes the dApp's owner (authoritative, not free-text).
        const acct = currentAccount(request, ctx.accounts);
        const body = request.body as HostedAgentConfig;
        if (acct) {
          body.createdBy = acct.address;
          // Freemium cap: a `free`-plan owner may host up to `freeMaxAgents`. Launching an agent they
          // already own (a restart/update) doesn't count; a NEW agent past the cap is refused with a
          // 402 + upgrade hint. `pro` accounts are uncapped. (0 = unlimited free tier.)
          const cap = ctx.config.freeMaxAgents;
          if (acct.plan === 'free' && cap > 0) {
            const handle = (body.handle ?? '').trim().toLowerCase();
            const owned = svc
              .status()
              .filter((a) => a.createdBy.toLowerCase() === acct.address.toLowerCase());
            const isExisting = owned.some((a) => a.handle.toLowerCase() === handle);
            if (!isExisting && owned.length >= cap) {
              return reply.code(402).send({
                error: `Free plan hosts up to ${cap} agents. Upgrade to Pro to host more.`,
                upgradeRequired: true,
              });
            }
          }
        }
        try {
          return await svc.launch(body);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      // Start/stop an agent. Allowed for an admin (any agent) or the operator who created it (their
      // own) — so a node owner can control their agents from the dashboard without an admin token,
      // while one operator can't stop another's agent on a shared node. Mirrors /hosted/launch's
      // participation rule (and is blocked on the reserved admin-only main node for non-admins).
      const controlAllowed = (request: Parameters<typeof currentAccount>[0], handle: string) => {
        const acct = currentAccount(request, ctx.accounts);
        if (!acct || acct.role === 'admin') return true; // admin, or an open/token-authed node
        const owner = svc.ownerOf(handle);
        return Boolean(owner && owner.toLowerCase() === acct.address.toLowerCase());
      };

      ctx.http.post('/hosted/stop', async (request, reply) => {
        const { handle } = (request.body ?? {}) as { handle?: string };
        if (!handle) return reply.code(400).send({ error: 'handle is required' });
        if (!requireParticipation(request, reply, ctx.accounts, ctx.config.adminOnly)) return;
        if (!controlAllowed(request, handle))
          return reply.code(403).send({ error: 'you can only stop an agent you created' });
        try {
          await svc.stop(handle);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
        return { agents: svc.status() };
      });

      ctx.http.post('/hosted/start', async (request, reply) => {
        const { handle } = (request.body ?? {}) as { handle?: string };
        if (!handle) return reply.code(400).send({ error: 'handle is required' });
        if (!requireParticipation(request, reply, ctx.accounts, ctx.config.adminOnly)) return;
        if (!controlAllowed(request, handle))
          return reply.code(403).send({ error: 'you can only start an agent you created' });
        try {
          await svc.start(handle);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
        return { agents: svc.status() };
      });
    },
  };
}
