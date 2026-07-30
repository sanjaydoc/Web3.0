/**
 * demo:web4 — a live end-to-end walkthrough of the whole Web 4.0 stack in one run:
 *
 *   1. launch a priced agent (Genesis-style)         → it auto-gets an ERC-8004 identity
 *   2. it's automatically an x402 API                → listed in /x402/directory
 *   3. a buyer pays the skill via x402               → EIP-3009 signed, settled on the PQC ledger
 *   4. the payment credits the agent's reputation    → economic score rises
 *   5. a client leaves feedback                      → blended (feedback + economic) trust score
 *   6. the ERC-8004 registration card                → carries the live trust snapshot
 *
 *   pnpm --filter @web3/node demo:web4
 *
 * Self-contained: boots a real node in-process (x402 facilitator + erc8004 + registry), no keys,
 * no external services. (For the Oxygen-MCP-in-Claude-Code flow, see `pnpm --filter @web3/node
 * demo:x402`.)
 */

import { generateKeypair } from '@web3/crypto';
import { randomPrivateKey, walletFromPrivateKey, x402Fetch } from '@web3/x402';
import { Kernel } from './kernel.js';
import { makeAgent } from './testkit.js';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const step = (n: number, s: string) => console.log(`\n${orange(`● ${n}.`)} ${bold(s)}`);
const ok = (s: string) => console.log(`   ${green('✓')} ${s}`);

async function main(): Promise<void> {
  process.env.WEB3_LOG_LEVEL = 'silent';
  const kernel = new Kernel(
    {
      port: 0,
      host: '127.0.0.1',
      x402: {
        enabled: true,
        network: 'base-sepolia',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x000000000000000000000000000000000000dEaD',
        domainName: 'USDC',
        domainVersion: '2',
        demoPriceAtomic: '50000',
        settle: 'ledger',
      },
    },
    generateKeypair(new Uint8Array(32).fill(21)),
  );
  await kernel.init();
  const base = await kernel.listen();
  const get = async (p: string) => (await fetch(`${base}${p}`)).json();

  console.log(bold('\n  WEB3.0 — WEB 4.0 STACK · END-TO-END WALKTHROUGH'));
  console.log(dim(`  node: ${base}\n`));

  try {
    // 1. Launch a priced agent.
    step(1, 'Launch a priced agent (Genesis: "monetize this skill" ON)');
    const agent = makeAgent('sage', {
      name: 'Sage',
      description: 'answers questions',
      skills: [{ id: 'ask', name: 'Ask', description: 'answer a question', tags: ['nlp'] }],
      pricing: { perTask: 500, currency: 'aETH' }, // $5.00
    });
    const reg = await fetch(`${base}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(agent.registration),
    });
    ok(`registered ${bold('sage@web3.0')} (HTTP ${reg.status}) · priced 5.00 aETH / call`);

    // 2. Auto ERC-8004 identity.
    step(2, 'ERC-8004 identity — minted automatically');
    const id = (await get('/erc8004/resolve?domain=sage@web3.0')) as {
      agentId: number;
      agentAddress: string;
      did: string;
    };
    ok(
      `agentId #${id.agentId} · address ${id.agentAddress.slice(0, 12)}… · ${id.did.slice(0, 22)}…`,
    );

    // 3. Auto x402 API.
    step(3, 'x402 API — the skill is auto-listed as a paid endpoint');
    const dir = (await get('/x402/directory')) as {
      services: { skillId: string; priceUsd: string; endpoint: string; payTo: string }[];
    };
    const svc = dir.services[0];
    ok(
      `${svc?.endpoint} · $${svc?.priceUsd} USDC · payTo ${svc?.payTo?.slice(0, 12)}… (= its ERC-8004 address)`,
    );

    // 4. A buyer pays the skill via x402.
    step(4, 'A buyer pays the skill (x402 · EIP-3009 signed · settled on the PQC ledger)');
    const wallet = walletFromPrivateKey(randomPrivateKey());
    const paid = await x402Fetch(`${base}/x402/call/sage@web3.0/ask?q=hello`, { wallet });
    const body = (await paid.response.json()) as { paid: { tx: string }; delivery: string };
    ok(
      `buyer ${wallet.address.slice(0, 12)}… paid ${green('$5.00')} · HTTP ${paid.response.status} · tx ${body.paid.tx.slice(0, 14)}… · delivery: ${body.delivery} (no brain attached in demo)`,
    );

    // 5. Payment → economic reputation.
    step(5, 'The payment lifts the agent’s ERC-8004 economic reputation');
    const rep1 = (await get(`/erc8004/agents/${id.agentId}/reputation`)) as {
      earnings: { paymentCount: number; totalEarnedAtomic: string };
      combined: { economicScore: number; score: number };
    };
    ok(
      `payments ${rep1.earnings.paymentCount} · earned $${(Number(rep1.earnings.totalEarnedAtomic) / 1e6).toFixed(2)} · economic score ${bold(String(rep1.combined.economicScore))}/100`,
    );

    // 6. Client feedback → blended trust.
    step(6, 'A client leaves feedback → blended (feedback + economic) trust score');
    await fetch(`${base}/erc8004/agents/${id.agentId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: '0xClient', score: 96, tag1: 'accuracy' }),
    });
    const rep2 = (await get(`/erc8004/agents/${id.agentId}/reputation`)) as {
      combined: { feedbackScore: number; economicScore: number; score: number };
    };
    ok(
      `feedback ${rep2.combined.feedbackScore} · economic ${rep2.combined.economicScore} → ${bold(`trust ${rep2.combined.score}/100`)}`,
    );

    // 7. The discoverable trust card.
    step(7, 'The ERC-8004 registration card external agents fetch to trust it');
    const card = (await get(`/erc8004/agents/${id.agentId}/card`)) as {
      trustModels: string[];
      reputation?: { score: number; totalEarnedAtomic: string };
    };
    ok(`trustModels: [${card.trustModels.join(', ')}]`);
    ok(
      `reputation snapshot in card: trust ${card.reputation?.score}/100 · earned $${(Number(card.reputation?.totalEarnedAtomic ?? 0) / 1e6).toFixed(2)}`,
    );

    console.log(`\n${green(bold('  ✓ ALL FEATURES EXERCISED'))}`);
    for (const line of [
      'x402 protocol + client + facilitator (@web3/x402)',
      'node x402 facilitator + settlement',
      'ERC-8004 identity / reputation / validation',
      'auto-priced skill + auto-bound wallet (derived ERC-8004 address)',
      'x402 earnings → economic reputation → blended trust',
      'discoverable registration card',
    ]) {
      console.log(`   ${green('✓')} ${line}`);
    }
    console.log(dim('\n   Oxygen MCP wallet (Claude Code):  pnpm --filter @web3/node demo:x402'));
    console.log(dim('   Dashboard GUI:                    pnpm --filter @web3/dashboard dev\n'));
  } finally {
    await kernel.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
