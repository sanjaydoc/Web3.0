import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Account, AccountsService, Role } from './accounts.js';

/** Pull the raw Web3.0 token from the request (header or bearer). */
export function bearerToken(request: FastifyRequest): string | undefined {
  const h = request.headers['x-web3-token'];
  if (typeof h === 'string' && h) return h;
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

/** The authenticated account for this request, or null. */
export function currentAccount(request: FastifyRequest, accounts: AccountsService): Account | null {
  return accounts.authenticate(bearerToken(request));
}

/**
 * True if the request may act as `role` (or higher). Precedence:
 *  - a valid account token with a matching role,
 *  - the legacy `WEB3_ADMIN_TOKEN` (always counts as admin, for back-compat),
 *  - if no accounts exist AND no admin token is set, the node is "open" (single-operator dev mode).
 * `admin` satisfies every role check.
 */
export function hasRole(request: FastifyRequest, accounts: AccountsService, role: Role): boolean {
  const acct = currentAccount(request, accounts);
  if (acct) return acct.role === 'admin' || acct.role === role;
  const adminToken = process.env.WEB3_ADMIN_TOKEN;
  if (adminToken && request.headers['x-admin-token'] === adminToken) return true;
  // Open only when the node has no accounts and no admin token configured.
  return !accounts.hasAccounts() && !adminToken;
}

/**
 * Guard: allow the request if it carries ANY authenticated account (operator, developer, admin),
 * the legacy admin token, or the node is open (no accounts configured). Replies 401 otherwise.
 * Use for actions any signed-in user may take (e.g. publishing a dApp), regardless of specific role.
 */
export function requireAuthed(
  request: FastifyRequest,
  reply: FastifyReply,
  accounts: AccountsService,
): boolean {
  if (currentAccount(request, accounts)) return true;
  const adminToken = process.env.WEB3_ADMIN_TOKEN;
  if (adminToken && request.headers['x-admin-token'] === adminToken) return true;
  if (!accounts.hasAccounts() && !adminToken) return true; // open single-operator dev node
  reply.code(401).send({ error: 'authentication required' });
  return false;
}

/**
 * Guard for compute/hosting actions on an admin-only node. When `adminOnly` is off it behaves like
 * `requireAuthed` (any signed-in account may participate). When on, only an admin may — everyone
 * else gets a 403 telling them to run their own node. This is what reserves the network's main node
 * for its admin so operators contribute from their own devices instead of leaning on it.
 */
export function requireParticipation(
  request: FastifyRequest,
  reply: FastifyReply,
  accounts: AccountsService,
  adminOnly: boolean,
): boolean {
  if (!requireAuthed(request, reply, accounts)) return false;
  if (!adminOnly || hasRole(request, accounts, 'admin')) return true;
  reply.code(403).send({
    error:
      "this is the network's main node — it's reserved for the admin. Download the app and run your own node to launch and host agents (you'll earn aETH for the compute it contributes).",
    adminOnly: true,
  });
  return false;
}

/** Guard: allow the request if it satisfies `role`, else reply 401/403 and return false. */
export function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  accounts: AccountsService,
  role: Role,
): boolean {
  if (hasRole(request, accounts, role)) return true;
  const authed = Boolean(currentAccount(request, accounts));
  reply.code(authed ? 403 : 401).send({
    error: authed ? `role '${role}' required` : 'authentication required',
  });
  return false;
}
