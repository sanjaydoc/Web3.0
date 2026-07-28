import type { ModuleContext, Web3Module } from '../context.js';
import { currentAccount, requireAuthed, requireRole } from '../services/auth.js';

/**
 * connectors — custom connector registry. `GET /connectors` lists the custom connectors an operator
 * added; `POST /connectors` registers one (any signed-in node operator); `DELETE /connectors/:id`
 * removes one (admin). The built-in catalogue of 30+ integrations lives in the dashboard.
 */
export function connectorsModule(): Web3Module {
  return {
    name: 'connectors',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, connectors } = ctx;

      http.get('/connectors', () => ({ connectors: connectors.list() }));

      http.post('/connectors', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const body = (request.body ?? {}) as {
          id?: string;
          name?: string;
          category?: string;
          endpoint?: string;
          description?: string;
        };
        const acct = currentAccount(request, ctx.accounts);
        try {
          const connector = await connectors.create({
            id: body.id ?? '',
            name: body.name ?? '',
            category: body.category,
            endpoint: body.endpoint,
            description: body.description,
            createdBy: acct?.address ?? 'open',
          });
          ctx.bus.emit({
            kind: 'connector.created',
            summary: `connector "${connector.id}" added — ${connector.name}`,
          });
          return reply.code(201).send(connector);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      http.delete('/connectors/:id', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        const { id } = request.params as { id: string };
        const removed = await connectors.remove(id);
        if (!removed) return reply.code(404).send({ error: `connector "${id}" not found` });
        return { ok: true };
      });
    },
  };
}
