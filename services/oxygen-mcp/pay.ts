/**
 * pay.ts — a standalone x402 payer. Pay any x402-priced URL WITHOUT Claude Code or the Oxygen MCP:
 * it signs the 402's payment requirement with a wallet and retries, exactly like Oxygen's x402_fetch.
 *
 * Usage (from the repo root) — pass the URL as a quoted argument (best on Windows):
 *   pnpm --filter @web3/oxygen-mcp exec tsx pay.ts "https://<node>/x402/call/<agent>/<skill>?q=hi"
 *
 * …or via an env var (bash):
 *   URL="https://<node>/x402/call/<agent>/<skill>?q=hi" pnpm --filter @web3/oxygen-mcp exec tsx pay.ts
 *
 * Optional env: KEY=0x<private-key> (pay from your own wallet; omit for a throwaway payer — fine on a
 * sandbox/ledger node, which verifies the signature, not an on-chain balance) and METHOD=GET|POST.
 */
import { randomPrivateKey, walletFromPrivateKey, x402Fetch } from '@web3/x402';

const url = process.argv[2] ?? process.env.URL;
if (!url) {
  console.error(
    'Pass an x402 URL as an argument, e.g.\n' +
      '  pnpm --filter @web3/oxygen-mcp exec tsx pay.ts "https://<node>/x402/call/<agent>/<skill>?q=hi"\n' +
      'Optional env: KEY=0x<private-key>, METHOD=GET|POST.',
  );
  process.exit(1);
}

const wallet = walletFromPrivateKey((process.env.KEY || randomPrivateKey()) as `0x${string}`);
console.log('Payer address:', wallet.address);

const result = await x402Fetch(url, { wallet, method: process.env.METHOD || 'GET' });
console.log(
  `Paid: ${result.paid}${result.amountPaid ? ` · amount(atomic) ${result.amountPaid}` : ''}`,
);
console.log('Settlement tx:', result.settlement?.transaction ?? '(none)');
console.log('Response:', await result.response.text());
