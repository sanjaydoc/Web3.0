import type { ModuleContext, Web3Module } from '../context.js';
import { adminRequired, checkAdmin } from '../services/admin.js';
import { currentAccount, requireRole } from '../services/auth.js';
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
        // A signed-in developer (not admin) sees only the dApps they created; admins/open see all.
        const agents =
          acct && acct.role === 'developer'
            ? all.filter((a) => a.createdBy.toLowerCase() === acct.address.toLowerCase())
            : all;
        return { agents, adminRequired: adminRequired(), scopedTo: acct?.address ?? null };
      });

      ctx.http.post('/hosted/launch', async (request, reply) => {
        // Developers (and admins) may publish; an open node with no accounts allows it too.
        // requireRole encodes all of that (account role / legacy admin token / open dev node).
        if (!requireRole(request, reply, ctx.accounts, 'developer')) return;
        // A signed-in developer's address becomes the dApp's owner (real, not free-text).
        const acct = currentAccount(request, ctx.accounts);
        const body = request.body as HostedAgentConfig;
        if (acct && acct.role === 'developer') body.createdBy = acct.address;
        try {
          return await svc.launch(body);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      ctx.http.post('/hosted/stop', async (request, reply) => {
        if (!checkAdmin(request, reply)) return;
        const { handle } = (request.body ?? {}) as { handle?: string };
        if (!handle) return reply.code(400).send({ error: 'handle is required' });
        try {
          await svc.stop(handle);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
        return { agents: svc.status() };
      });
    },
  };
}
