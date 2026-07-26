import { buildTransfer, signTransaction, web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
import { Kernel } from '../src/kernel.js';

const seed = (n: number) => new Uint8Array(32).fill(n);

/** Poll a predicate until true or timeout — for asserting on async gossip/replication. */
async function waitFor(fn: () => boolean, timeout = 5_000, interval = 25): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('waitFor timed out');
}

/**
 * The end-to-end proof of trustless peer writes: two real nodes over the consensus WebSocket.
 * A FOLLOWER signs up an account (forwarded to the authority), then submits an account-signed
 * transfer that only an authority can seal. We assert both the account binding and the payment
 * cross the wire in both directions and the balances converge on both nodes.
 */
describe('two-node network: follower writes reach the shared chain', () => {
  const authKeys = generateKeypair(seed(50));
  const authPub = toB64u(authKeys.publicKey);
  const aliceKeys = generateKeypair(seed(1));
  const bobKeys = generateKeypair(seed(2));
  const ALICE = web3Id('alice');
  const BOB = web3Id('bob');

  let authority: Kernel;
  let follower: Kernel;
  let grant: number;
  let aliceToken: string;

  const send = (k: Kernel, url: string, body: unknown, headers: Record<string, string> = {}) =>
    k.http
      .inject({ method: 'POST', url, payload: body as object, headers })
      .then((r) => ({ status: r.statusCode, json: r.json() as Record<string, unknown> }));

  beforeAll(async () => {
    const consensus = (peers: string[]) => ({
      mode: 'poa' as const,
      authorities: [authPub],
      peers,
      blockMs: 40, // propose fast so the test doesn't wait seconds
      slotMs: 0, // single authority, always its turn — no skip
    });
    // Authority first, so we know its port before the follower dials it.
    authority = new Kernel({ port: 0, host: '127.0.0.1', consensus: consensus([]) }, authKeys);
    await authority.init();
    const addr = await authority.listen();
    const port = new URL(addr).port;
    grant = authority.config.faucetGrant;

    follower = new Kernel(
      { port: 0, host: '127.0.0.1', consensus: consensus([`http://127.0.0.1:${port}`]) },
      generateKeypair(seed(51)),
    );
    await follower.init();
    await follower.listen();
  });

  afterAll(async () => {
    await follower.close();
    await authority.close();
  });

  it('the follower is not an authority; the authority is', () => {
    expect(authority.consensus.isAuthority()).toBe(true);
    expect(follower.consensus.isAuthority()).toBe(false);
  });

  it('a signup on the follower is forwarded to the authority and replicates back', async () => {
    // Hitting the FOLLOWER — it must forward to the authority (which mints + binds on-chain).
    const a = await send(follower, '/accounts/signup', {
      local: 'alice',
      role: 'operator',
      pubkey: toB64u(aliceKeys.publicKey),
    });
    expect(a.status).toBe(201);
    aliceToken = a.json.token as string;
    const b = await send(follower, '/accounts/signup', {
      local: 'bob',
      role: 'operator',
      pubkey: toB64u(bobKeys.publicKey),
    });
    expect(b.status).toBe(201);

    // The authority created them...
    expect(authority.networkAccounts.has(ALICE)).toBe(true);
    // ...and the bindings + faucet grants replicate to the follower over the block gossip.
    await waitFor(
      () =>
        follower.networkAccounts.has(ALICE) &&
        follower.networkAccounts.has(BOB) &&
        follower.ledger.balanceOf(ALICE) >= grant,
    );
    // The follower also mirrored the account, so its token authenticates locally.
    const meGet = await follower.http.inject({
      method: 'GET',
      url: '/accounts/me',
      headers: { 'x-web3-token': aliceToken },
    });
    expect(meGet.statusCode).toBe(200);
  });

  it('a follower resolves login for an account it never adopted (survives a peer restart)', async () => {
    // Create carol directly on the AUTHORITY — the follower never adopts her locally, exactly as if
    // the follower had restarted and lost its in-memory account records.
    const carolKeys = generateKeypair(seed(4));
    const c = await send(authority, '/accounts/signup', {
      local: 'carol',
      role: 'operator',
      pubkey: toB64u(carolKeys.publicKey),
    });
    expect(c.status).toBe(201);
    const carolToken = c.json.token as string;
    // /accounts/me on the FOLLOWER must still resolve carol — it forwards login to the authority.
    const me = await follower.http.inject({
      method: 'GET',
      url: '/accounts/me',
      headers: { 'x-web3-token': carolToken },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { address: string }).address).toBe(web3Id('carol'));
  });

  it('a key re-bind on the follower is forwarded to the authority (not locally 401d)', async () => {
    // Sign up dave straight on the AUTHORITY so the follower never holds his token — the exact case
    // of a fresh desktop (follower) whose account/token live upstream. Re-binding a NEW signing key
    // via the FOLLOWER must forward to the authority (which knows the token), NOT reject it locally.
    const daveKeys = generateKeypair(seed(5));
    const d = await send(authority, '/accounts/signup', {
      local: 'dave',
      role: 'operator',
      pubkey: toB64u(daveKeys.publicKey),
    });
    expect(d.status).toBe(201);
    const daveToken = d.json.token as string;

    // A different device's key — rotate to it by re-binding through the follower.
    const daveKeys2 = generateKeypair(seed(6));
    const rebind = await follower.http.inject({
      method: 'POST',
      url: '/accounts/key',
      headers: { 'x-web3-token': daveToken },
      payload: { pubkey: toB64u(daveKeys2.publicKey) },
    });
    expect(rebind.statusCode).toBe(200); // regression: was 401 "authentication required"

    // The authority recorded the new key on-chain, and it replicates to the follower.
    const DAVE = web3Id('dave');
    await waitFor(() => follower.networkAccounts.pubkeyOf(DAVE) === toB64u(daveKeys2.publicKey));
    expect(authority.networkAccounts.pubkeyOf(DAVE)).toBe(toB64u(daveKeys2.publicKey));
  });

  it('a follower-submitted transfer is sealed by the authority and converges on both nodes', async () => {
    // Alice signs a transfer on the follower and submits it to the FOLLOWER's /tx. The follower
    // can't seal (not an authority) — it gossips the tx to the authority, which seals it.
    const nonce = follower.consensus.nextNonce(ALICE);
    const tx = signTransaction(
      aliceKeys,
      buildTransfer({ from: ALICE, to: BOB, amount: 300, nonce }),
    );
    const res = await send(follower, '/tx', tx);
    expect(res.status).toBe(202);

    // The authority seals it into a block; both nodes end up with the same balances.
    await waitFor(
      () =>
        authority.ledger.balanceOf(ALICE) === grant - 300 &&
        authority.ledger.balanceOf(BOB) === grant + 300 &&
        follower.ledger.balanceOf(ALICE) === grant - 300 &&
        follower.ledger.balanceOf(BOB) === grant + 300,
    );

    // Nonce advanced on-chain, visible from the follower too.
    expect(follower.consensus.nextNonce(ALICE)).toBe(1);
  });
});
