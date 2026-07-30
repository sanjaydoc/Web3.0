# Conway Terminal — an x402 wallet for Claude Code (MCP)

Give Claude Code (or any MCP client) a wallet that pays for the internet. Conway Terminal is an
[MCP](https://modelcontextprotocol.io) server exposing two tools:

| Tool | What it does |
|------|--------------|
| `wallet_info` | Show the agent's x402 wallet address, spendable **USDC** balance, and total spent. |
| `x402_fetch` | Fetch any URL, auto-paying if it returns **HTTP 402** — a signed transaction, no API keys, no signup. |

It speaks the [x402](https://www.x402.org) standard via [`@web3/x402`](../../packages/web3-x402),
so it pays any x402-priced API — a Web3.0 node's priced resources, or anything behind an OpenX402 /
CDP facilitator.

```
● Testing x402 payment flow.
● Bash curl https://getpredictiondata.xyz/v1/markets/top
    └ 402 Payment Required · $0.05 USDC
● Bash x402-fetch https://getpredictiondata.xyz/v1/markets/top
    └ 200 · { markets: [...] } · paid $0.05 via x402
● mcp: conway-terminal wallet_info
    └ balance: $49.95 USDC
```

## Connect it to Claude Code

Add to your project's `.mcp.json` (or `claude mcp add`):

```json
{
  "mcpServers": {
    "conway-terminal": {
      "command": "pnpm",
      "args": ["--filter", "@web3/conway-terminal", "exec", "tsx", "src/index.ts"],
      "cwd": "/absolute/path/to/Web3.0",
      "env": {
        "CONWAY_WALLET_KEY": "0x<your-funded-secp256k1-key>",
        "CONWAY_START_USDC": "50000000"
      }
    }
  }
}
```

Then ask Claude: *"check my wallet"* → `wallet_info`, or *"fetch the top prediction markets from
`<url>` and pay if needed"* → `x402_fetch`.

## Configuration

| Env var | Meaning | Default |
|---------|---------|---------|
| `CONWAY_WALLET_KEY` | secp256k1 private key (0x-hex) the wallet signs with. | ephemeral (regenerated each start) |
| `CONWAY_START_USDC` | Starting balance in atomic USDC (6dp), for local/ledger mode. | `50000000` (= $50.00) |
| `CONWAY_RPC_URL` | EVM RPC — when set, balance is read **on-chain** via `balanceOf` instead of tracked locally. | unset |
| `CONWAY_ASSET` | USDC contract address for on-chain balance reads. | unset |

**Local mode** (no RPC): balance is `CONWAY_START_USDC` minus what you've spent — self-contained,
great for demos against a Web3.0 node's `settle=ledger` facilitator.

**Live mode** (`CONWAY_RPC_URL` + `CONWAY_ASSET` set, e.g. Base Sepolia USDC): balance is the real
on-chain USDC balance, and payments settle for real when the target's facilitator is on that chain.

> The wallet holds a real key. In local/demo mode it never touches a chain. To pay real (testnet)
> USDC, fund the address and point it at a live facilitator — see the repo's x402 docs.
