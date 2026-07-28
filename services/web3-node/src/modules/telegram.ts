import type { ModuleContext, Web3Module } from '../context.js';
import { adminRequired, checkAdmin } from '../services/admin.js';
import { TelegramService } from '../services/telegram.js';

/**
 * telegram — a GUI-managed Telegram front door. All settings (bot token, enabled) come from the
 * dashboard and persist in the Store; nothing lives in .env. The bot runs inside the node and
 * bridges humans to Web3.0 agents. Management endpoints are admin-gated (see services/admin.ts).
 */
export function telegramModule(): Web3Module {
  return {
    name: 'telegram',
    version: '0.1.0',
    async register(ctx: ModuleContext) {
      const svc = new TelegramService(ctx);
      await svc.load(); // restore persisted config and auto-start if it was enabled

      ctx.http.get('/telegram', () => ({ ...svc.status(), adminRequired: adminRequired() }));

      ctx.http.post('/telegram/config', async (request, reply) => {
        if (!checkAdmin(request, reply)) return;
        try {
          return await svc.setConfig((request.body ?? {}) as Record<string, unknown>);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      ctx.http.post('/telegram/start', async (request, reply) => {
        if (!checkAdmin(request, reply)) return;
        try {
          await svc.start();
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
        return svc.status();
      });

      ctx.http.post('/telegram/stop', async (request, reply) => {
        if (!checkAdmin(request, reply)) return;
        await svc.stop();
        return svc.status();
      });

      ctx.http.addHook('onClose', async () => {
        await svc.stop();
      });
    },
  };
}
