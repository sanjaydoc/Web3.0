import type { AcpModule, ModuleContext } from '../context.js';
import type { Role } from '../services/accounts.js';
import { requireRole } from '../services/auth.js';

/**
 * accounts — sign-up + identity. `POST /accounts/signup` mints a human address (`local@web3.0`) and a
 * one-time ACP token; `GET /accounts/me` resolves the caller's account from that token; `GET /accounts`
 * (admin) lists them. This replaces the single shared ACP_ADMIN_TOKEN with real per-user roles.
 */
export function accountsModule(): AcpModule {
  return {
    name: 'accounts',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, accounts } = ctx;

      http.post('/accounts/signup', async (request, reply) => {
        const body = (request.body ?? {}) as { local?: string; role?: Role };
        const local = (body.local ?? '').trim();
        const role: Role = body.role ?? 'developer';
        if (!local) return reply.code(400).send({ error: 'local (handle) is required' });

        // The first account bootstraps as admin freely. After that, minting an admin requires admin.
        if (
          role === 'admin' &&
          accounts.hasAdmin() &&
          !requireRole(request, reply, accounts, 'admin')
        ) {
          return;
        }
        try {
          const created = await accounts.signup(local, role);
          ctx.bus.emit({
            kind: 'account.created',
            summary: `${created.address} signed up as ${created.role}`,
          });
          // The token is returned exactly once — the client must save it now.
          return reply.code(201).send(created);
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      http.get('/accounts/me', async (request, reply) => {
        const acct = accounts.authenticate(
          (request.headers['x-acp-token'] as string | undefined) ??
            (typeof request.headers.authorization === 'string' &&
            request.headers.authorization.startsWith('Bearer ')
              ? request.headers.authorization.slice(7)
              : undefined),
        );
        if (!acct) return reply.code(401).send({ error: 'authentication required' });
        return accounts.view(acct);
      });

      http.get('/accounts', async (request, reply) => {
        if (!requireRole(request, reply, accounts, 'admin')) return;
        return { accounts: accounts.list() };
      });
    },
  };
}
