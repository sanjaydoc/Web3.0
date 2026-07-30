#!/usr/bin/env -S npx tsx
/**
 * Oxygen MCP — an MCP (Model Context Protocol) server exposing an x402 wallet over stdio.
 *
 * With this connected, Claude Code (or any MCP client) can:
 *   • `wallet_info`  — see its USDC address, balance, and total spent
 *   • `x402_fetch`   — call any x402-priced API, auto-paying the 402 with a signed transaction
 *
 * No API keys, no signup — just a signed EIP-3009 authorization, exactly like the terminal mockup.
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP stdio transport). Kept
 * dependency-free (no MCP SDK) to match the rest of Web3.0's lean style.
 *
 * Env:
 *   OXYGEN_WALLET_KEY   secp256k1 private key (0x-hex). Ephemeral if unset.
 *   OXYGEN_START_USDC   starting balance, atomic USDC (6dp). Default 50000000 (= $50.00).
 *   OXYGEN_RPC_URL      EVM RPC — when set, balance is read on-chain instead of tracked locally.
 *   OXYGEN_ASSET        USDC contract for on-chain balance reads.
 */

import { x402Fetch } from '@web3/x402';
import { OxygenWallet, formatUsdc } from './wallet.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'oxygen-mcp', version: '0.1.0' };

const wallet = new OxygenWallet({
  privateKey: process.env.OXYGEN_WALLET_KEY,
  startingAtomic: process.env.OXYGEN_START_USDC,
  rpcUrl: process.env.OXYGEN_RPC_URL,
  asset: process.env.OXYGEN_ASSET,
});

// Startup banner goes to stderr — stdout is reserved for the JSON-RPC stream.
process.stderr.write(`oxygen-mcp · wallet ${wallet.address} · fund it to pay for x402 resources\n`);

const TOOLS = [
  {
    name: 'wallet_info',
    description:
      'Show this agent’s x402 wallet: address, spendable USDC balance, and total spent so far.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'x402_fetch',
    description:
      'Fetch a URL, automatically paying if it returns HTTP 402 (x402). Returns the response and a payment receipt. Use for x402-priced APIs, data, and agent services.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch (an x402-priced endpoint).' },
        method: { type: 'string', description: 'HTTP method. Default GET.' },
        body: { type: 'string', description: 'Optional request body (for POST/PUT).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
] as const;

// ── tool implementations ─────────────────────────────────────────────────────────────────────────

async function walletInfo(): Promise<string> {
  const balance = await wallet.balanceAtomic();
  return JSON.stringify(
    {
      address: wallet.address,
      balance: formatUsdc(balance),
      balanceAtomic: balance.toString(),
      spent: formatUsdc(wallet.spent),
      payments: wallet.payments,
      asset: 'USDC',
    },
    null,
    2,
  );
}

async function x402FetchTool(args: {
  url: string;
  method?: string;
  body?: string;
}): Promise<string> {
  const { url, method, body } = args;
  const result = await x402Fetch(url, {
    wallet: wallet.signer,
    method: method ?? 'GET',
    ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}),
  });
  if (result.paid && result.amountPaid) wallet.recordSpend(result.amountPaid);

  const text = await result.response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  const balance = await wallet.balanceAtomic();
  return JSON.stringify(
    {
      status: result.response.status,
      paid: result.paid,
      amountPaid: result.paid ? formatUsdc(result.amountPaid ?? '0') : null,
      via: result.paid ? `x402 (${result.requirement?.network})` : null,
      settlement: result.settlement ?? null,
      balanceAfter: formatUsdc(balance),
      body: parsed,
    },
    null,
    2,
  );
}

// ── JSON-RPC / MCP plumbing ────────────────────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

function reply(id: RpcRequest['id'], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
function replyError(id: RpcRequest['id'], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}
function toolResult(
  text: string,
  isError = false,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

async function handle(req: RpcRequest): Promise<void> {
  switch (req.method) {
    case 'initialize':
      reply(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case 'notifications/initialized':
    case 'initialized':
      return; // notification, no response
    case 'ping':
      reply(req.id, {});
      return;
    case 'tools/list':
      reply(req.id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      try {
        if (params.name === 'wallet_info') {
          reply(req.id, toolResult(await walletInfo()));
        } else if (params.name === 'x402_fetch') {
          const a = params.arguments as { url?: string; method?: string; body?: string };
          if (!a?.url) {
            reply(req.id, toolResult('x402_fetch requires a "url" argument', true));
            return;
          }
          reply(
            req.id,
            toolResult(await x402FetchTool(a as { url: string; method?: string; body?: string })),
          );
        } else {
          reply(req.id, toolResult(`unknown tool: ${params.name}`, true));
        }
      } catch (err) {
        reply(
          req.id,
          toolResult(`error: ${err instanceof Error ? err.message : String(err)}`, true),
        );
      }
      return;
    }
    default:
      if (req.id !== undefined && req.id !== null) {
        replyError(req.id, -32601, `method not found: ${req.method}`);
      }
  }
}

// Read newline-delimited JSON-RPC from stdin.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let nl: number;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard line-splitting loop
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let req: RpcRequest;
    try {
      req = JSON.parse(line) as RpcRequest;
    } catch {
      continue; // ignore malformed lines
    }
    void handle(req);
  }
});
process.stdin.on('end', () => process.exit(0));
