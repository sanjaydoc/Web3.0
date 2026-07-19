import type { ModuleContext, Web3Module } from '../context.js';
import { currentAccount, requireAuthed } from '../services/auth.js';

/**
 * skills — the skill catalogue. `GET /skills` lists registered skill definitions; `POST /skills`
 * lets any signed-in node operator define a new one (stamped with their address). Agents still
 * advertise which skills they offer via the registry; this names and describes the skills.
 */
export function skillsModule(): Web3Module {
  return {
    name: 'skills',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, skills } = ctx;

      http.get('/skills', () => ({ skills: skills.list() }));

      http.post('/skills', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const body = (request.body ?? {}) as { id?: string; name?: string; description?: string };
        const acct = currentAccount(request, ctx.accounts);
        try {
          const skill = await skills.create({
            id: body.id ?? '',
            name: body.name ?? '',
            description: body.description,
            createdBy: acct?.address ?? 'open',
          });
          ctx.bus.emit({
            kind: 'skill.created',
            summary: `skill "${skill.id}" added — ${skill.name}`,
          });
          return reply.code(201).send(skill);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
