# Design: decentralized compute marketplace

Status: **partially shipped**. The "self-building internet" promise: agents earn by **hosting other
people's agents**, and anyone can rent that capacity — no VPS.

## Shipped (Phases 1–5)

- **Two personas** (mutually exclusive at signup): **agent-owner** (creates agents, pays to have them
  hosted) and **node operator** (contributes RAM, hosts, earns). Each gets its own dashboard.
- **RAM is real capacity**: a node's `maxAgents` is derived from contributed RAM
  (`floor(maxRamMb / ramMbPerAgent)`, 256 MB/agent default) and enforced at launch — you can't host
  more than your RAM backs. (Closes the "100s of agents, no RAM" gaming hole.)
- **Hosting marketplace** (`hosting` module + `HostingService`): a host publishes a per-epoch price
  (`POST /hosting/offer`); an agent-owner browses `GET /hosting/market` and rents capacity for an
  agent (`POST /hosting/rent`), creating a **lease** billed each epoch. Dashboard: Marketplace view
  (owner) + Hosting card (host).
- **Demand-funded, with a platform commission**: each epoch the owner pays the lease price; the host
  receives the fee **minus a 3% platform commission** (`hostingCommissionBps`, default 300) which goes
  to the treasury. This replaces the minted reward pool as the primary earn path — money flows from
  real demand, not issuance.
- **Minted pool demoted**: `nodeRewardPool` stays as an **optional, default-off bootstrap subsidy**;
  marketplace fees are primary.

### Where ML-DSA fits

The marketplace runs on the existing post-quantum foundation: owner/host **identities and wallets**
are ML-DSA keypairs bound on-chain; every hosting-fee and commission transfer is recorded on the
**PQC-signed, hash-chained ledger** and sealed by **ML-DSA authority signatures** (PoA). Manual
transfers (`/tx`) are individually ML-DSA-signed by the payer. The **recurring per-epoch charge** is
settled with an internal authoritative `ledger.transfer` (like protocol fees / block rewards) — it is
*not* individually owner-signed, because auto-billing can't prompt for the client-side secret key each
epoch. **Hardening step (not yet built):** a **signed lease mandate** — at rent time the owner
ML-DSA-signs a "debit up to X/epoch for this lease" authorization, verified on each charge — to make
every recurring debit individually owner-authorized.

### Remaining / hardening

- **Cross-node placement runtime**: leases + billing + offers are implemented node-locally; launching
  the owner's agent on a *remote* host's `HostedAgentService` (and on-chain replicated leases for
  cross-node deterministic billing) is the remaining integration.
- **Signed lease mandate** (above), reputation/SLAs, and market-clearing pricing.

---

## Original design (for reference)

This doc turned the promise into a plan grounded in what already existed.

## What already exists (building blocks)
- **Hosted agents** (`hosted` module + `HostedAgentService`): a node runs others' agents/dApps
  in-process, with per-node contribution limits (`My node` console: RAM, max-agents).
- **Payments + fees**: per-task settlement in aETH on the PQC ledger; protocol fee to treasury.
- **Accounts/roles** (`accounts`): developer/operator identities with `WEB3_TOKEN`.
- **Node resources**: `/node` already reports RAM, CPU, uptime, and the operator's declared limits.

The marketplace is the **matching + pricing + settlement layer** that connects a developer who wants
their agent hosted with an operator who has spare capacity.

## Core objects
- **Capacity offer** (operator → market): `{ operator, maxRamMb, maxAgents, pricePerTaskBps or
  pricePerHour, regions, updatedAt }`. Derived from the existing `node-limits` + `/node` resources.
- **Hosting request** (developer → market): `{ developer, agentSpec (Genesis/dApp config), budget,
  constraints }`.
- **Placement**: the market assigns a request to an offer; the operator launches it via the existing
  `HostedAgentService`; the developer's address (from `accounts`) is stamped as owner.
- **Hosting receipt**: each served task already produces a ledger payment; the marketplace adds an
  **operator revenue split** (a % of hosted agents' per-task fees) as a first-class fee, alongside the
  existing protocol fee.

## Phased plan
1. **Registry of capacity.** A `market` module: operators publish/refresh offers (signed, from their
   account); `GET /market/offers` lists live capacity. Reuse `node-limits` + `/node` resources.
2. **Placement API.** `POST /market/host` (developer-auth) → picks an offer meeting constraints and
   launches the agent on that node via `HostedAgentService`. Start with a simple policy
   (cheapest-fit / most-free-RAM); make it pluggable.
3. **Revenue split.** Extend the payments fee logic (already skims a protocol fee) to also credit the
   **hosting operator** a configurable share of each hosted-agent task fee. Auditable ledger entries.
4. **Reputation & SLAs.** Track per-operator uptime/latency (the event bus + `/node` give the raw
   signal); surface a score; let requests filter by it. Later: stake-backed SLAs tied to the
   BFT/PoS work (slash for dropped hosting).
5. **Cross-node scheduling.** Today a node hosts locally; the market lets a request land on *another*
   operator's node. This is the step that makes it a real network, not per-node.

## Interfaces (sketch)
```ts
interface CapacityOffer { operator: string; maxRamMb: number; maxAgents: number; priceBps: number; regions: string[]; freeRamMb: number }
interface HostRequest { developer: string; spec: HostedAgentConfig; budget: number; minScore?: number }
interface Market {
  offers(): CapacityOffer[];
  place(req: HostRequest): Promise<{ operator: string; web3Id: string }>;
}
```

## Economics
- Three levers already exist (protocol fee, block reward, hosting revenue). The marketplace turns
  **hosting revenue** from "the agent earns" into "**the operator earns a cut for providing the
  machine**" — the incentive that makes strangers contribute compute.
- Pricing starts operator-set (per-task bps or per-hour); a later phase can add market-clearing
  (auction) once there's liquidity.

## Dependencies / ordering
- Needs **accounts** (done) for developer/operator identity and **payments/fees** (done) for splits.
- Reputation SLAs are stronger once **BFT/PoS staking + slashing** lands (see `BFT-POS.md`).
- Cross-node placement needs node-to-node auth (accounts tokens between nodes) — a small extension of
  the current peer gossip.

## Testing strategy
- In-process: two operator nodes publish offers; a developer request is placed on the cheaper-fit
  node; a served task credits the operator's split on the ledger; an over-budget/over-capacity request
  is rejected.
