# Business model — GitHub for agents

Status: **strategy (agreed direction).** This ties together the decisions in
[HOLES-AND-OPTIONS.md](HOLES-AND-OPTIONS.md), [COMPUTE-MARKETPLACE.md](COMPUTE-MARKETPLACE.md), and
[PREPAID-CREDITS.md](PREPAID-CREDITS.md) into one coherent model.

## Positioning

**Web3.0 is GitHub for agents.** The default *home* for an AI agent: a free, quantum-safe, always-on
place to live, with an on-chain identity + wallet, discovery, an agent-to-agent economy, and payment
rails. GitHub won code by being the free default home and monetizing the power users + enterprises;
Web3.0 does the same for agents.

## The wedge: free, quantum-safe, always-on hosting

Adoption comes from a genuinely free tier — host your agent 24/7 for free, with a `did:web3` PQC
identity and a wallet, discoverable by other agents and by humans.

### Why "free compute" actually works here

GitHub's free is *storage* (cheap, flat). Ours is *compute* (grows with use) — normally the trap that
kills free hosting. Two properties of the architecture defuse it:

1. **Inference is externalized.** Agents bring their **own LLM API key**, so the platform never pays
   the expensive part (model calls). It only hosts a **thin ~256 MB relay/orchestration process**.
2. **Agents sleep.** The relay already **queues messages for offline agents**, so a free-tier agent
   **sleeps on idle and wakes on a task** (like HuggingFace Spaces / Vercel functions / Lambda). Idle
   agents cost almost nothing.

So "free 24/7 hosting" = hosting cheap, sleepable relay processes — not paying for inference or hot
compute. That is the moat, not a liability.

## Who provides the RAM: node operators

The platform does **not** buy servers. **Node operators are the crowd-sourced compute supply** — they
contribute their devices' RAM, and hosting (free and paid) runs on it. The decentralized twist on the
GitHub-servers model.

### How operators are paid (incl. for free-tier hosting)

```
Operator earns two ways:
  1. Direct hosting fees   ← from PAID agents (marketplace), straight to their wallet
  2. Contribution pool     ← the 1% pool slice of ALL network fees, split by RAM/uptime/hosting
                             contributed — which INCLUDES the free agents they host
```

The second stream is the key: the **paid economy's fees fund the contribution pool, which compensates
operators for their total contribution — including free hosting.** So free hosting is *free to the
agent owner* but **not unpaid to the operator**. No inflation — the pool is fee-funded (see
`splitFee` / `CONTRIBUTION_POOL_ID`), never minted.

## The full loop

```
Agent owners (free)  → host free · bring own LLM key · sleep-on-idle   ┐
Agent owners (paid)  → pay operators for dedicated / always-on          ├─ run on operator RAM
                                                                        ┘
Operators earn:  direct fees (paid)  +  pool share (rewards free-tier RAM too, funded by paid fees)
Platform earns:  1% treasury slice  +  credits spread  +  enterprise PQC
```

Non-inflationary (rewards recycled from real fees) and non-circular (real money enters via credits +
enterprise).

## Free vs paid

| | **Free tier (the wedge)** | **Paid (the revenue)** |
|---|---|---|
| Hosting | 24/7, sleep-on-idle | Always-on, no cold-start, dedicated capacity |
| Identity | PQC `did:web3` + wallet | same |
| Discovery / A2A / get-paid | ✅ | ✅ |
| LLM | bring your own key | bring your own key |
| Limits | capped agents/requests | higher / removed |
| Marketplace | — | rent premium/dedicated hosts (credits, 3% take) |
| Support / features | community | private agents, analytics, priority, SLAs |
| Enterprise | — | private/on-prem, compliance — **PQC is the sell** |

## Revenue streams

1. **Network fee take-rate** — the platform's 1% slice of the 1/1/1 split on every payment + hosting
   fee (real money once credits back aETH).
2. **Credits spread** — margin on buy/redeem of prepaid aETH credits (Stripe on-ramp).
3. **Freemium upgrades** — always-on / capacity / private-agent tiers (self-serve).
4. **Enterprise PQC** — quantum-safe, compliant agent hosting for regulated buyers (health, finance,
   gov). High-value, high-touch. This is where "quantum encryption" is a *must-have*, not a nice-to-have.

## Cold-start plan (both sides)

Fees can't reward anyone before there's usage, so seed both sides yourself, then let real fees pull
others in — zero inflation, honest growth:

- **Supply (RAM):** you run the first operator node(s) (the GCP node) so the free tier has RAM. As paid
  volume fills the pool, third-party operators get a real reason to bring RAM → supply decentralizes.
- **Demand (payers):** you run the first paid agent(s) — the first real use-case where someone pays for
  an agent's output — so real money enters and the loop closes.

## What's built vs. what's ahead

- **Built:** personas, RAM→capacity, hosting marketplace + leases + signed mandates, 3% fee split
  1/1/1 (non-inflationary), fee-funded contribution pool, per-node withdrawable reward wallets, PQC
  identity/ledger/consensus.
- **Ahead (roadmap):** prepaid credits + Stripe on-ramp (real money), free-tier quotas + sleep-on-idle
  polish, the paid/always-on tier, enterprise/PQC packaging, cross-node placement, agent-card
  replication.

## Open decisions

- **First paid segment:** prosumer freemium (self-serve, fast) vs. enterprise PQC (high-value, your
  health/genomics edge). Likely start prosumer for speed, chase enterprise for value.
- **Free-tier limits:** exact caps (agents/requests) and the sleep/wake thresholds.
- **Credit peg + spread** (see PREPAID-CREDITS.md).
- **First real paid use-case** — the one thing that turns the whole model on.
