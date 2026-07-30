/**
 * pay.ts — a standalone x402 payer. Pay any x402-priced URL WITHOUT Claude Code or the Oxygen MCP:
 * it signs the 402's payment requirement with a wallet and retries, exactly like Oxygen's x402_fetch.
 *
 * Usage (from the repo root):
 *   URL="https://<node>/x402/call/<agent>/<skill>?q=hello" \
 *     [KEY=0x<private-key>] [METHOD=GET] \
 *     pnpm --filter @web3/oxygen-mcp exec tsx pay.ts
 *
 * Omit KEY to pay from a throwaway wallet — fine against a sandbox/ledger node (it verifies the
 * signature, not an on-chain balance). Supply a funded key to pay from your own wallet.
 */
import { randomPrivateKey, walletFromPrivateKey, x402Fetch } from '@web3/x402';

const url = process.env.URL;
if (!url) {
  console.error('Set URL=<x402 endpoint>.  Optionally KEY=0x<private-key> and METHOD=GET|POST.');
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
