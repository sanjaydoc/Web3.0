import { toMinorUnits } from '@web3/core';
import { generateKeypair } from '@web3/crypto';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
import pg from 'pg';
import { Kernel } from '../src/kernel.js';
import { PostgresStore } from '../src/store/postgres.js';
import { makeAgent, sealAs } from '../src/testkit.js';

// Only runs when a real Postgres is reachable (CI without one skips it). Locally:
//   WEB3_TEST_POSTGRES_URL=postgresql://web3@127.0.0.1:5433/web3 pnpm --filter @web3/node test
const URL = process.env.WEB3_TEST_POSTGRES_URL;
const suite = URL ? describe : describe.skip;

suite('PostgreSQL store (real database)', () => {
  beforeAll(async () => {
    // Start each run from a clean slate.
    const pool = new pg.Pool({ connectionString: URL });
    const s = new PostgresStore(URL as string);
    await s.init(); // ensure the tables exist before truncating
    await s.close();
    await pool.query('TRUNCATE agents, ledger_entries, settings');
    await pool.end();
  });

  it('persists agents, balances, settings and a verified chain across a restart', async () => {
    const nodeKeys = generateKeypair(); // stable node identity across the "reboot"

    // --- first boot: register two agents, settle a payment, save a setting ---
    const store1 = new PostgresStore(URL as string);
    const k1 = new Kernel({ port: 0 }, nodeKeys, store1);
    await k1.init();
    const alice = makeAgent('pgalice');
    const bob = makeAgent('pgbob');
    await k1.http.inject({ method: 'POST', url: '/agents', payload: alice.registration });
    await k1.http.inject({ method: 'POST', url: '/agents', payload: bob.registration });
    await k1.http.inject({
      method: 'POST',
      url: '/pay',
      payload: sealAs(alice, { from: alice.web3Id, to: bob.web3Id, amount: toMinorUnits(7) }),
    });
    await store1.saveSetting('demo', { hello: 'world', n: 42 });
    await k1.close();

    // --- second boot: a brand-new kernel + store on the SAME database ---
    const store2 = new PostgresStore(URL as string);
    const k2 = new Kernel({ port: 0 }, nodeKeys, store2);
    await k2.init();

    // agents came back
    const agentsRes = await k2.http.inject({ method: 'GET', url: '/agents' });
    const ids = (agentsRes.json() as { agents: { web3Id: string }[] }).agents.map((a) => a.web3Id);
    expect(ids).toContain(alice.web3Id);
    expect(ids).toContain(bob.web3Id);

    // balance replayed from the persisted ledger (faucet grant + the 7.00 aETH payment)
    const walletRes = await k2.http.inject({ method: 'GET', url: `/wallets/${bob.web3Id}` });
    expect((walletRes.json() as { wallet: { balance: number } }).wallet.balance).toBe(
      k2.config.faucetGrant + toMinorUnits(7),
    );

    // the post-quantum signature chain still verifies after the round-trip
    const ledgerRes = await k2.http.inject({ method: 'GET', url: '/ledger' });
    expect((ledgerRes.json() as { verify: { ok: boolean } }).verify.ok).toBe(true);

    // a JSON setting survived intact
    expect(await store2.loadSetting('demo')).toEqual({ hello: 'world', n: 42 });

    await k2.close();
  });
});
