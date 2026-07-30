/**
 * x402 demo — reproduces the "Claude Code + Oxygen MCP" flow end to end:
 *
 *   ● curl  https://…/markets/top            → 402 Payment Required · $0.05 USDC
 *   ● x402-fetch https://…/markets/top       → 200 · { markets: [...] } · paid $0.05 via x402
 *   ● oxygen-mcp wallet_info                 → balance: $49.95 USDC
 *
 * It boots a real Web3.0 node (acting as an x402 resource server AND a permissionless facilitator),
 * spawns the Oxygen MCP server as the paying wallet, and drives it over MCP stdio — no
 * external services, no keys required.
 *
 *   pnpm --filter @web3/node demo:x402
 */

import { spawn } from 'node:child_process';
import { generateKeypair } from '@web3/crypto';
import { randomPrivateKey } from '@web3/x402';
import { Kernel } from './kernel.js';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const PAY_TO = '0x000000000000000000000000000000000000dEaD';
const RESOURCE = '/x402/demo/markets/top';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const bullet = (s: string) => console.log(`${orange('●')} ${s}`);
const sub = (s: string) => console.log(`   ${dim('└')} ${s}`);

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
        payTo: PAY_TO,
        domainName: 'USDC',
        domainVersion: '2',
        demoPriceAtomic: '50000',
        settle: 'ledger',
      },
    },
    generateKeypair(new Uint8Array(32).fill(11)),
  );
  await kernel.init();
  const base = await kernel.listen();
  const url = `${base}${RESOURCE}`;

  console.log(bold('\n  CLAUDE CODE + OXYGEN MCP\n'));

  // Spawn the Oxygen MCP server as our wallet (funded locally with $50).
  const child = spawn('pnpm', ['--filter', '@web3/oxygen-mcp', 'exec', 'tsx', 'src/index.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, OXYGEN_WALLET_KEY: randomPrivateKey(), OXYGEN_START_USDC: '50000000' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  let buf = '';
  const waiters = new Map<number, (v: unknown) => void>();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => {
    buf += c;
    let nl: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard line-splitting loop
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number };
        if (msg.id !== undefined && waiters.has(msg.id)) waiters.get(msg.id)?.(msg);
      } catch {
        /* ignore */
      }
    }
  });
  let idc = 0;
  const rpc = (method: string, params?: unknown): Promise<any> =>
    new Promise((resolve) => {
      const id = ++idc;
      waiters.set(id, resolve as (v: unknown) => void);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const callText = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse((await rpc('tools/call', { name, arguments: args })).result.content[0].text);

  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

    bullet('Testing x402 payment flow.');
    console.log();

    // 1) Unpaid curl → 402.
    bullet(`${bold('Bash')} curl ${url}`);
    const bare = await fetch(url);
    const q = (await bare.json()) as { accepts: Array<{ maxAmountRequired: string }> };
    const price = (Number(q.accepts[0]?.maxAmountRequired ?? 0) / 1e6).toFixed(2);
    sub(green(`${bare.status} Payment Required · $${price} USDC`));
    console.log();

    // 2) x402_fetch → pays and gets 200.
    bullet(`${bold('Bash')} x402-fetch ${url}`);
    const paid = await callText('x402_fetch', { url });
    sub(
      green(
        `${paid.status} · { markets: [${paid.body.markets.length}] } · paid ${paid.amountPaid} via x402`,
      ),
    );
    console.log();

    // 3) wallet_info via MCP.
    bullet(`${bold('mcp:')} oxygen-mcp wallet_info`);
    const info = await callText('wallet_info');
    sub(green(`balance: ${info.balance} USDC`));
    console.log();

    console.log(orange(`● Your API is live at ${base}`));
    console.log(dim('● Agents pay $0.05–$0.10/query via x402 + a permissionless facilitator.'));
    console.log(dim('● No API keys. No signup. Just a signed transaction.'));
    console.log(dim(`● Spent ${info.spent} total.`));
    console.log();
  } finally {
    child.kill();
    await kernel.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
