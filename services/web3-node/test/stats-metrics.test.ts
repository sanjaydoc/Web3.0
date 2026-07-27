import { generateKeypair, toB64u } from '@web3/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB3_LOG_LEVEL = 'silent';
import { Kernel } from '../src/kernel.js';
import { type ContributionReport, signHeartbeat } from '../src/services/contribution.js';
import { makeAgent } from '../src/testkit.js';

/**
 * The dashboard's headline numbers — "Agents", "Agents online", "Nodes online" in Overview and the
 * Network map — all come from GET /stats. This asserts that endpoint reports the WHOLE network's
 * values (summed from every node's gossiped heartbeat), not just this node's local counts, and that
 * infrastructure treasuries never inflate the agent count. This is the "one shared network, no island
 * nodes" guarantee at the endpoint the UI actually reads.
 */
describe('GET /stats — network-wide metrics the dashboard shows', () => {
  let kernel: Kernel;

  beforeAll(async () => {
    kernel = new Kernel({ port: 0, host: '127.0.0.1' });
    await kernel.init();
  });
  afterAll(async () => {
    await kernel.close();
  });

  const get = async (url: string) => {
    const res = await kernel.http.inject({ method: 'GET', url });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  };
  const post = async (url: string, body: unknown) => {
    const res = await kernel.http.inject({ method: 'POST', url, payload: body as object });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  };

  /** Simulate a peer node gossiping a signed heartbeat. `agentsHosted` counts that node's own
   *  treasury card (1) plus its real agents — exactly what a live node advertises. */
  const gossipFrom = (agentsHosted: number, online: number): boolean => {
    const keys = generateKeypair();
    const report: ContributionReport = {
      nodeKey: toB64u(keys.publicKey),
      uptimeSec: 3_600,
      agentsHosted,
      txServed: online,
      ts: Date.now(),
    };
    return kernel.contribution.ingest(signHeartbeat(keys, report));
  };

  it('sums agents & online across all live nodes and subtracts one treasury per node', async () => {
    // Node A: 2 real agents (+1 treasury = 3 hosted), 2 online. Node B: 1 real (+1 = 2 hosted), 1 online.
    expect(gossipFrom(3, 2)).toBe(true);
    expect(gossipFrom(2, 1)).toBe(true);

    const { status, json } = await get('/stats');
    expect(status).toBe(200);
    expect(json.nodes).toBe(2); // two live nodes on the shared network
    expect(json.agents).toBe(3); // (3 + 2) hosted − 2 treasuries = 3 real agents network-wide
    expect(json.online).toBe(2 + 1); // connected agents summed across nodes
    expect(json.ledgerVerified).toBe(true);
  });

  it('exposes the agents that registered on this node via GET /agents, with wallets on the ledger', async () => {
    const alice = makeAgent('metrics-alice', { name: 'Alice' });
    const bob = makeAgent('metrics-bob', { name: 'Bob' });
    expect((await post('/agents', alice.registration)).status).toBe(201);
    expect((await post('/agents', bob.registration)).status).toBe(201);

    const agents = await get('/agents');
    expect(agents.status).toBe(200);
    const ids = (agents.json.agents as { web3Id: string }[]).map((a) => a.web3Id);
    expect(ids).toContain(alice.web3Id);
    expect(ids).toContain(bob.web3Id);

    // The ledger endpoint records each registration + its faucet grant, and verifies its own chain.
    const ledger = await get('/ledger');
    expect(ledger.status).toBe(200);
    expect((ledger.json.verify as { ok: boolean }).ok).toBe(true);
    expect(ledger.json.size as number).toBeGreaterThanOrEqual(2);

    // `totalAgents` is the cumulative "ever created" count from the ledger's register entries —
    // it counts both agents whether or not any node is currently reporting them live.
    const stats = await get('/stats');
    expect(stats.json.totalAgents as number).toBeGreaterThanOrEqual(2);
  });
});
