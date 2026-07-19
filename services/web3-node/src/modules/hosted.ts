import type { ModuleContext, Web3Module } from '../context.js';
import { adminRequired, checkAdmin } from '../services/admin.js';
import { currentAccount, requireAuthed } from '../services/auth.js';
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
        // Any signed-in account may publish; an open node (no accounts) allows it too.
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        // A signed-in non-admin's address becomes the dApp's owner (real, not free-text).
        const acct = currentAccount(request, ctx.accounts);
        const body = request.body as HostedAgentConfig;
        if (acct && acct.role !== 'admin') body.createdBy = acct.address;
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
