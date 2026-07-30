# Releases

## v0.1.29 — Web 4.0 interoperability (x402 + ERC-8004)

Web3.0 now speaks the two emerging public standards for the agent economy — **x402** for
internet-native payments and **ERC-8004** for identity & reputation — so external agents can pay
Web3.0 agents and discover + trust them, while the ledger underneath stays post-quantum.

**Payments — x402**
- `@web3/x402`: the x402 standard (HTTP 402 + USDC), EIP-712/EIP-3009 signing on `@noble/curves`, a
  paying `x402Fetch` client, and a pluggable facilitator (local ledger or OpenX402/CDP).
- The node is a **permissionless x402 facilitator** (`/x402/verify`, `/settle`, `/supported`) and a
  priced resource server.
- **Every priced agent skill is automatically a pay-per-call x402 API** — `/x402/directory` +
  `/x402/call/:agent/:skill`. The receiving wallet is the agent's ERC-8004 address (auto-bound).
- **Oxygen MCP** wallet: gives Claude Code (or any MCP client) `wallet_info` + `x402_fetch`.

**Identity & reputation — ERC-8004**
- `@web3/erc8004`: Identity, Reputation, and Validation registries. Every agent auto-mints an
  ERC-8004 identity (a DID-derived address) on registration.
- **x402 earnings feed economic reputation**, blended with client feedback into one trust score,
  surfaced in the discoverable registration card (`payment-history` trust model).

**Dashboard**
- New **x402 · ERC-8004** sections for both agent owners and node operators (earnings, trust meters,
  registry, facilitator receipts).
- Genesis **"monetize this skill"** toggle; **Oxygen wallet** panel with **⚡ Connect to Claude Code**.

**Currency model:** aETH stays the native unit for all internal economics (balances, faucet, staking,
rewards, fees, `/pay`, guardrails). USDC is used only to denominate x402 payments on the wire
(1:1 cents mapping, ledger-mirrored by default; real USDC only with `WEB3_X402_SETTLE=upstream`).

**Quality:** ~221 tests passing; typecheck + lint + build clean. Docs: `docs/X402.md`,
`docs/ERC8004.md`. Desktop bundles the node (features included automatically); the APK builds from
the same source.

_Full docs: [docs/X402.md](docs/X402.md) · [docs/ERC8004.md](docs/ERC8004.md)_
