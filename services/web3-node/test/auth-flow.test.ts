import { createHash } from 'node:crypto';
import { generateKeypair } from '@web3/crypto';
import { describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
// These tests exercise real account auth (no legacy master key), so the admin-token bypass must be off.
process.env.WEB3_ADMIN_TOKEN = undefined;
process.env.WEB3_ADMIN_TOKEN = '';
// Point the store-downgrade marker at a path that won't exist, so booting these memory kernels never
// trips the "refuse to downgrade" guard on a machine that happens to have a real marker.
process.env.WEB3_STORE_MODE_FILE = '/nonexistent/web3-authflow/store-mode';
import { Kernel } from '../src/kernel.js';
import { MemoryStore } from '../src/store/index.js';

// A fixed node seed so a "restart" (a new Kernel over the same store) keeps the same signing key,
// and the persisted ledger + account tokens still verify.
const SEED = new Uint8Array(32).fill(9);
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

function boot(store: MemoryStore): Kernel {
  return new Kernel({ port: 0, host: '127.0.0.1' }, generateKeypair(SEED), store);
}
const tok = (t: string) => ({ 'x-web3-token': t });
const jsonHdr = (t?: string) => ({ 'content-type': 'application/json', ...(t ? tok(t) : {}) });

/**
 * The regression suite for the whole login saga: a valid token must authenticate, must keep working
 * across a node restart, and a wrong/absent token must be rejected — while `/operator/*` and
 * `/accounts/me` agree (the bug we chased was them DISAGREEING, which only happens in open mode).
 */
describe('account auth end-to-end', () => {
  it('signs up, logs in, survives restart, and rejects wrong/absent tokens', async () => {
    const store = new MemoryStore();
    let kernel = boot(store);
    await kernel.init();

    const su = await kernel.http.inject({
      method: 'POST',
      url: '/accounts/signup',
      headers: jsonHdr(),
      payload: { local: 'sanjay', role: 'admin' },
    });
    expect(su.statusCode).toBe(201);
    const token = su.json().token as string;
    const address = su.json().address as string;
    expect(address).toBe('sanjay@web3.0');
    expect(token).toMatch(/^web3_/);

    // Correct token → 200 and resolves the right account.
    const me = await kernel.http.inject({
      method: 'GET',
      url: '/accounts/me',
      headers: tok(token),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().address).toBe(address);
    expect(me.json().role).toBe('admin');

    // Wrong token and absent token → 401 (never a silent pass).
    expect(
      (await kernel.http.inject({ method: 'GET', url: '/accounts/me', headers: tok('web3_nope') }))
        .statusCode,
    ).toBe(401);
    expect((await kernel.http.inject({ method: 'GET', url: '/accounts/me' })).statusCode).toBe(401);

    // The admin token authorizes a privileged write...
    const eco = await kernel.http.inject({
      method: 'POST',
      url: '/operator/economics',
      headers: jsonHdr(token),
      payload: { blockReward: 50 },
    });
    expect(eco.statusCode).toBe(200);
    expect(eco.json().blockReward).toBe(50);

    // ...and the SAME privileged write with NO token is rejected — proving the node is NOT open
    // (accounts are loaded). This is exactly the mismatch that made "operator works, login doesn't".
    expect(
      (
        await kernel.http.inject({
          method: 'POST',
          url: '/operator/economics',
          headers: jsonHdr(),
          payload: { blockReward: 1 },
        })
      ).statusCode,
    ).toBe(401);

    // The new auth-visibility field reports loaded accounts, not open mode.
    const node = await kernel.http.inject({ method: 'GET', url: '/node' });
    expect(node.json().auth).toMatchObject({ accounts: 1, hasAdmin: true, openMode: false });

    await kernel.close();

    // ---- restart over the same persisted store: login must still work ----
    kernel = boot(store);
    await kernel.init();
    const me2 = await kernel.http.inject({
      method: 'GET',
      url: '/accounts/me',
      headers: tok(token),
    });
    expect(me2.statusCode).toBe(200);
    expect(me2.json().address).toBe(address);
    await kernel.close();
  });

  it('token rotation: after swapping the stored hash and restarting, the new token works and the old fails', async () => {
    const store = new MemoryStore();
    let kernel = boot(store);
    await kernel.init();
    const su = await kernel.http.inject({
      method: 'POST',
      url: '/accounts/signup',
      headers: jsonHdr(),
      payload: { local: 'sanjay', role: 'admin' },
    });
    const oldToken = su.json().token as string;
    await kernel.close();

    // Exactly what the recovery script does: replace sanjay's tokenHash in the persisted store.
    const accounts = (await store.loadSetting<{ address: string; tokenHash: string }[]>(
      'accounts',
    )) as { address: string; tokenHash: string }[];
    const newToken = 'web3_rotated_token_for_test';
    const acct = accounts.find((a) => a.address === 'sanjay@web3.0')!;
    acct.tokenHash = sha256hex(newToken);
    await store.saveSetting('accounts', accounts);

    kernel = boot(store);
    await kernel.init();
    expect(
      (await kernel.http.inject({ method: 'GET', url: '/accounts/me', headers: tok(newToken) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await kernel.http.inject({ method: 'GET', url: '/accounts/me', headers: tok(oldToken) }))
        .statusCode,
    ).toBe(401);
    await kernel.close();
  });

  it('exposes the caller OWN earnings (wallet + income), separate from the node treasury', async () => {
    const store = new MemoryStore();
    const kernel = boot(store);
    await kernel.init();

    // An operator account (not admin) — the case that was wrongly shown the node treasury.
    const su = await kernel.http.inject({
      method: 'POST',
      url: '/accounts/signup',
      headers: jsonHdr(),
      payload: { local: 'alice', role: 'operator' },
    });
    const token = su.json().token as string;
    const address = su.json().address as string;

    // Give alice income and an outgoing payment straight on the ledger.
    const bob = await kernel.http.inject({
      method: 'POST',
      url: '/accounts/signup',
      headers: jsonHdr(),
      payload: { local: 'bob', role: 'operator' },
    });
    const bobAddr = bob.json().address as string;
    kernel.ledger.mint(address as never, 500);
    kernel.ledger.transfer(address as never, bobAddr as never, 100);

    const earn = await kernel.http.inject({
      method: 'GET',
      url: '/accounts/me/earnings',
      headers: tok(token),
    });
    expect(earn.statusCode).toBe(200);
    const j = earn.json();
    expect(j.address).toBe(address);
    expect(j.role).toBe('operator');
    expect(j.balance).toBe(kernel.ledger.balanceOf(address as never));
    expect(j.received).toBeGreaterThanOrEqual(500); // faucet grant + the 500 mint
    expect(j.sent).toBe(100);
    expect(j.txCount).toBeGreaterThanOrEqual(2);

    // Never exposed to an anonymous caller.
    expect(
      (await kernel.http.inject({ method: 'GET', url: '/accounts/me/earnings' })).statusCode,
    ).toBe(401);
    await kernel.close();
  });

  it('open mode is explicit: a fresh node with no accounts reports openMode and (only then) accepts unauthenticated privileged calls', async () => {
    const store = new MemoryStore();
    const kernel = boot(store);
    await kernel.init();

    const node = await kernel.http.inject({ method: 'GET', url: '/node' });
    expect(node.json().auth).toMatchObject({ accounts: 0, hasAdmin: false, openMode: true });

    // Documents (and pins) the single-operator dev behavior: with no accounts AND no admin token,
    // privileged endpoints answer any caller. The moment a real account exists, this closes (asserted above).
    const eco = await kernel.http.inject({
      method: 'POST',
      url: '/operator/economics',
      headers: jsonHdr(),
      payload: { blockReward: 1 },
    });
    expect(eco.statusCode).toBe(200);
    await kernel.close();
  });
});
