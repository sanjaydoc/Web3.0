# Web4.0 — Business Model

> **Canonical.** This is the single source of truth for how Web4.0 works economically. It supersedes
> every earlier economics/monetization design note. Currency is **USDC** (non-custodial; no native
> token, no staking, no minting).

## The three participants

| | **Agent Owner** | **Node Operator** | **Community User** |
|---|---|---|---|
| **Client** | Web browser | Web browser | Community desktop app |
| **Contributes / shares** | Nothing | System **RAM** (+ optional LLM brain) → reservoir | **RAM** (+ qwen2.5:3b brain) → reservoir |
| **Gets** | Agents hosted on rented RAM | — | **1 free agent per 1 GB** contributed |
| **Pays** | **Hosting rent** + **inference fees** (USDC) | Nothing | Nothing (barter: RAM for agents) |
| **Earns** | **x402** call fees to their agents (**97%**) | **70%** of rent + **70%** of inference | Nothing (no money) |
| **Platform take** | 3% on x402 | 30% on rent + 30% on inference | — |
| **Free or paid** | **Pays** to run, earns from usage | **Paid** (pure supplier) | **Free** both ways |
| **Where agents run** | On **paid** reservoir RAM | Hosts others' paid agents | On **free** community RAM (their own slice) |

## Money flow

```
Community desktop → gives RAM → keeps a slice for its own free agents (runs LOCAL)
                             ↘ surplus RAM → RAM RESERVOIR (paid → TREASURY)
Pro operator      → gives RAM ───────────→ RAM RESERVOIR (paid → operator keeps 70%)
Browser owner     → USDC → rents RESERVOIR → platform 30% / operator 70%
Caller            → USDC → agent owner (x402, owner keeps 97%)
```

## The one rule that keeps it clean

> **Free agents run only on free RAM. Paid agents run only on paid RAM. You can only take for free
> what you give — money is the only way to take more.**

A community user contributes **1 GB** but a free agent needs only **~256 MB**, so contributing 1 GB
unlocks **1 free agent** and donates the **surplus** (~768 MB) into the paid reservoir. That surplus is
the platform's sellable inventory. Free RAM never subsidizes a paid operator, and a paid renter never
gets community RAM for free.

### How a community node splits its RAM

```
surplus_slots = floor(contributedMB / ramPerAgent)  −  ownReserved  −  bodiesHostedForOthers
ownReserved   = communityAgentCap(contributedMB)     # 1 GB = 1 agent
```

- The owner's own free agents (`ownReserved`) run **locally** on the community node and are **never
  migrated** onto a paid operator.
- The **surplus** is advertised to the reservoir with the **treasury** as payee, so a browser owner
  renting it is billed at the admin reservoir rate and the rent flows to the **platform** (the
  community user took free agents instead of money).

**Example — a 2 GB contribution:** `floor(2048/256) = 8` slots → reserve **2** for the owner's free
agents → **6** slots sold to the paid reservoir.

## Rates (defaults; admin-editable at runtime)

| Fee | Rate | Who pays | Who receives |
|---|---|---|---|
| Hosting commission | **30%** | agent owner (via rent) | 70% operator · 30% treasury |
| Inference commission | **30%** | agent owner (via inference) | 70% operator · 30% treasury |
| x402 skill-call fee | **3%** | the caller | 97% agent owner · 3% treasury (non-custodial) |
| Reservoir RAM price | `ramPricePerGbHour` | agent owner | operator 70% / treasury (community surplus) |

Set the reservoir price to `0` for a free bootstrap phase (community surplus is donated free); set it
above `0` to start charging for reservoir RAM.

## Why each side shows up

- **Agent Owner** — runs agents without owning hardware; pays for hosting + inference, earns from the
  calls their agents serve (x402).
- **Node Operator** — a pure supplier; earns 70% of the rent + inference their contributed RAM/brain
  serves.
- **Community User** — barters idle RAM for free agents. Contributes far more than they consume; the
  surplus is what funds the network.

---

# How it works (mechanism)

> Fused from the former `RAM-RESERVOIR`, `COMPUTE-MARKETPLACE`, and `community-installer-planning`
> design notes, updated to this business model. Those files were removed to keep one source of truth.

## The RAM reservoir — a pooled, admin-priced compute pool

All contributed RAM is treated as **one logical pool** with **one admin-set global price**. RAM stays
physically on operator machines (a body always runs on some real operator's memory); what's centralized
is **pricing + capacity accounting**:

- Operators (paid) and community users (surplus) contribute RAM → pool capacity grows.
- The **admin sets one global price** `ramPricePerGbHour`; nobody sets a per-operator price.
- Every paid agent is auto-allocated from the pool and billed that one rate per epoch.
- The operator running a paid body keeps **70%** (100 − 30% hosting commission). Community **surplus**
  RAM is billed to the **treasury** (the contributor took free agents instead of money).

### Pricing math (micro-USDC + cent-precision floor)

`ramPricePerGbHour` is in **micro-USDC per GB-hour** (`1_000_000` = $1.00/GB-hour) — micro granularity
because the target price is a *fraction* of cloud RAM. The exact per-agent-per-epoch charge:

```
chargePerEpoch = ramPricePerGbHour            # µUSD per GB-hour (1e6 = $1)
                 × (ramMbPerAgent / 1024)      # GB one agent uses (256 MB = 0.25 GB default)
                 × (epochMs / 3_600_000)        # fraction of an hour per epoch
                 / 10_000                       # µUSD → USDC minor
```

The value is **not rounded**. A sub-minor charge **accumulates** (`carry`) and settles one whole minor
once `carry ≥ 1`; the 30/70 commission carries the same way, so the split stays exact over time and
nothing is minted or leaked. `ramChargePerEpoch()` lives in `services/hosting.ts`; `0 = reservoir off`
→ free bootstrap (legacy per-operator price applies if an operator set one). `GET /hosting/reservoir`
returns the pooled view (operators, used/free/total slots, GB, price).

## Remote agent-body placement (the RAM economy)

An agent's **body** (its task loop) runs on a host's machine, not just the node you connect to:

- **Placement.** A **paid** owner's agent (browser) is auto-placed onto the first available reservoir
  host (capacity gossiped in the heartbeat: `hostServeId` + `hostFreeSlots` + `hostAccount`). The owner
  mints the agent's **public identity card once** and hands it over, so the host runs the **same
  web3Id/DID** — the private key never leaves the owner. **Community own-agents are the exception: they
  run locally on the contributor's own node and are never migrated onto a paid host** (free stays on
  free RAM).
- **Secrets stay home.** A placed body's connector / office-tool fetch is proxied back to the owner
  node (`connector.request/response`, and `__office:<tool>` for email/calendar), which runs it with its
  own vault credentials and returns **only text**. The host never sees a secret.
- **Per-epoch rent.** Placement opens a `HostingService` lease at the reservoir rate; the epoch timer
  bills owner→host on the shared ledger (host nets 70%, 30% commission to treasury; community-surplus
  rent → treasury). Each debit can be authorized by a **host-agnostic ML-DSA lease mandate** the owner
  signs.
- **Failover.** If a host's heartbeat goes stale, the reconciler ends its lease and **orphans** the
  body → it re-places onto a live host (the offline host earns nothing while down).

## The Community ("Free Agents") tier — one codebase, a config flag

A **config flag `communityMode`** (env `WEB3_COMMUNITY_MODE`, set by the community `network.json`)
turns the standard desktop app into the free tier — no forked app, no parallel pipeline:

- Enforces the per-owner cap (**1 GB = 1 free agent**, delete-to-replace).
- Force-locks the contribution to the RAM dial (2 GB floor → 128 GB) + a 3 GB LLM (`qwen2.5:3b`).
- **Suppresses this node's own rent/inference earnings** — the contribution is free; the surplus RAM
  is donated to the reservoir with the treasury as payee.
- x402 to the owner's own agents still settles normally (owner keeps 97%).

The **same dashboard** renders a reduced community nav when the connected node reports `communityMode`;
the web console (connected to the authority node) is unaffected. The community installer is the same
Electron app built with the community `network.json` + a distinct product name ("Web4.0 Free Agents").
