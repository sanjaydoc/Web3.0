import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Guard for management endpoints (Telegram config, launching hosted agents) that are driven from the
 * dashboard rather than .env. If WEB3_ADMIN_TOKEN is set (recommended in production), a matching
 * `x-admin-token` header is required. If it is unset, management is open — convenient for a local
 * single-operator run, and the dashboard surfaces that it is unauthenticated.
 */
export function adminRequired(): boolean {
  return Boolean(process.env.WEB3_ADMIN_TOKEN);
}

/** Returns true if the request may perform admin actions; otherwise replies 401 and returns false. */
export function checkAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.WEB3_ADMIN_TOKEN;
  if (!expected) return true; // open when no admin token configured
  const provided = request.headers['x-admin-token'];
  if (provided === expected) return true;
  reply.code(401).send({ error: 'admin token required' });
  return false;
}
