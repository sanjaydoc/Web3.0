import type { AcpModule, ModuleContext } from '../context.js';
import { adminRequired, checkAdmin } from '../services/admin.js';
import { type HostedAgentConfig, HostedAgentService } from '../services/hosted.js';

/**
 * hosted — launch and run Genesis agents inside the node (the GUI "no-VPS host"). Management
 * endpoints are admin-gated; the read-only list is open so the dashboard can show what's running.
 */
export function hostedModule(): AcpModule {
  return {
    name: 'hosted',
    version: '0.1.0',
    async register(ctx: ModuleContext) {
      const svc = new HostedAgentService(ctx);
      await svc.load(); // relaunch persisted hosted agents

      ctx.http.get('/hosted', () => ({ agents: svc.status(), adminRequired: adminRequired() }));

      ctx.http.post('/hosted/launch', async (request, reply) => {
        if (!checkAdmin(request, reply)) return;
        try {
          return await svc.launch(request.body as HostedAgentConfig);
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
