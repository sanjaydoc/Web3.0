/**
 * Distributed L1 demo: three real ACP nodes form a proof-of-authority chain, gossip blocks over
 * WebSocket, and converge on one canonical, signed block history.
 *
 * Run:  pnpm --filter @acp/node demo:consensus
 */
import { generateKeypair, toB64u } from '@acp/crypto';
import { Kernel } from './kernel.js';
import { MemoryStore } from './store/index.js';
import { makeAgent } from './testkit.js';

process.env.ACP_LOG_LEVEL = 'silent';

async function main(): Promise<void> {
  const N = 3;
  const keys = Array.from({ length: N }, () => generateKeypair());
  const authorities = keys.map((k) => toB64u(k.publicKey));
  const ports = [8931, 8932, 8933];
  const urls = ports.map((p) => `http://127.0.0.1:${p}`);

  // Boot N nodes that share the authority set; each dials the other two as peers.
  const nodes = await Promise.all(
    keys.map(async (nodeKeys, i) => {
      const peers = urls.filter((_, j) => j !== i);
      const kernel = new Kernel(
        {
          port: ports[i]!,
          consensus: { mode: 'poa', authorities, peers, blockMs: 500 },
        },
        nodeKeys,
        new MemoryStore(),
      );
      await kernel.init();
      await kernel.listen();
      return kernel;
    }),
  );
  console.log(`\n\x1b[1m${N} ACP nodes online, authorities set, peers dialed.\x1b[0m`);
  console.log(`authorities: ${authorities.map((a) => `${a.slice(0, 8)}…`).join('  ')}\n`);

  // Each node registers a local agent → ledger entries that its authority will batch into a block.
  for (let i = 0; i < N; i++) {
    await nodes[i]!.http.inject({
      method: 'POST',
      url: '/agents',
      payload: makeAgent(`node${i}svc`).registration,
    });
    console.log(`node ${i} registered an agent (will propose it on its turn)`);
  }

  // Poll until all nodes agree on the same height and head hash (or time out).
  const deadline = Date.now() + 12_000;
  let converged = false;
  while (Date.now() < deadline) {
    await sleep(400);
    const statuses = nodes.map((n) => n.consensus.status());
    const heights = statuses.map((s) => s.height);
    const heads = new Set(statuses.map((s) => s.head));
    console.log(`  heights: [${heights.join(', ')}]  distinct heads: ${heads.size}`);
    if (heights.every((h) => h === N) && heads.size === 1) {
      converged = true;
      break;
    }
  }

  console.log('');
  if (converged) {
    const s = nodes[0]!.consensus.status();
    console.log(
      `\x1b[32m✅ Consensus reached.\x1b[0m All ${N} nodes agree on a ${s.height}-block chain.`,
    );
    console.log(`   canonical head: ${s.head.slice(0, 24)}…`);
    for (let i = 0; i < N; i++) {
      const verified = nodes[i]!.consensus.engine!.chain.verifyChain().ok;
      console.log(
        `   node ${i}: height ${nodes[i]!.consensus.status().height}, chain verified: ${verified}`,
      );
    }
  } else {
    console.log('\x1b[31m✗ did not converge in time\x1b[0m (try increasing the timeout)');
  }

  await Promise.all(nodes.map((n) => n.close()));
  process.exit(converged ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
