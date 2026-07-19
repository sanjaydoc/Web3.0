<div align="center">

# 🛰️ ACP — The Agentic Internet

**A quantum-resistant Web3.0 network where AI agents get an identity and a wallet, discover each other, communicate, pay, and share data — no VPS, no middleman.**

_Every agent gets an email-like Web3.0 ID (`alice@web3.0`). Every message, payment, and ledger entry is signed with post-quantum cryptography._

![CI](https://img.shields.io/badge/CI-passing-success)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Python](https://img.shields.io/badge/python-3.10%20|%203.11%20|%203.12-blue)
![PQC](https://img.shields.io/badge/crypto-ML--DSA%20%2F%20ML--KEM%20(NIST)-000000)
![A2A](https://img.shields.io/badge/protocol-A2A%20aligned-635bff)
![License](https://img.shields.io/badge/license-MIT-green)
![Tests](https://img.shields.io/badge/tests-44%20passing-success)

[Why](#why) · [The five gaps](#the-problem-five-gaps) · [Architecture](#architecture) · [Quantum security](#quantum-security-the-honest-version) · [Quickstart](#quickstart) · [Demo](#the-demo) · [Console](#the-console) · [Modules](#modules) · [Roadmap](#roadmap)

<br />

<img src="docs/media/dashboard-overview.png" alt="ACP console — live overview with agents, payments, and guardrail decisions" width="90%" />

<sub>The ACP console (LabSuite theme) showing live agent activity, payments, and ALLOW/DENY guardrail decisions.</sub>

</div>

---

## Why

Open-source AI agents can't yet live on the internet as first-class citizens. Running one 24/7
means renting a VPS. Two agents from different authors have no shared language to talk. There's
no built-in way to pay for another agent's work, no guardrails, and no observability. ACP is a
small, honest attempt to fix that: an **agent communication protocol** with identity, messaging,
payments, guardrails, and a verifiable ledger — assembled from open standards and
NIST-standardized post-quantum cryptography.

## The problem (five gaps)

| # | Gap | ACP's answer |
| - | --- | --- |
| 1 | Every agent needs its own VPS to run 24/7 | Relay queues messages for offline agents; hosting marketplace on the [roadmap](#roadmap) |
| 2 | No agent-to-agent communication protocol | **messaging** module — signed A2A relay ([A2A](https://a2a-protocol.org)-aligned) |
| 3 | No observability or guardrails | **guardrails** (ALLOW/DENY policies) + **observability** (live feed, ledger) modules |
| 4 | No agentic payments | **payments** module — x402 handshake + signed aETH token transfers |
| 5 | No agentic operating system | A thin **kernel** that loads capabilities as modules |

## Architecture

ACP is a **module-first monorepo**. The node is a thin kernel; every capability is a module you
can add or remove via config.

```
Web3.0/
├── packages/
│   ├── acp-crypto     # post-quantum primitives: ML-DSA signatures, ML-KEM sealed boxes, DIDs
│   ├── acp-core       # protocol types: Web3.0 IDs, agent cards, wallets, signed envelopes, A2A tasks
│   ├── acp-ledger     # quantum-resistant append-only ledger: PQC-signed, hash-linked, with payments
│   └── acp-sdk-py     # Python agent SDK (interoperable ML-DSA / ML-KEM)
├── services/
│   └── acp-node       # the kernel + modules: naming · registry · messaging · payments · guardrails · observability
├── apps/
│   └── dashboard      # LabSuite-themed observability & guardrails console (React + Vite)
├── examples/
│   └── two-agents-demo# the end-to-end proof
└── docs/              # GitHub Pages site — see docs/ARCHITECTURE.md, PROTOCOL.md, QUANTUM.md
```

Full write-ups: **[Architecture](docs/ARCHITECTURE.md)** · **[Protocol](docs/PROTOCOL.md)** · **[Quantum security](docs/QUANTUM.md)**.

## Quantum security (the honest version)

ACP is **quantum-resistant, not "unhackable"** — no system is unhackable, and a literal
quantum-computing blockchain isn't shippable today. What *is* real and standardized is
**post-quantum cryptography**, and that's what ACP uses everywhere identity or integrity matters:

- **ML-DSA-65** (FIPS 204, "Dilithium") — signatures on identities, messages, payments, and ledger entries
- **ML-KEM-768** (FIPS 203, "Kyber") — confidential data sharing between agents

The MVP ledger is a **verifiable, PQC-signed, append-only log** — not a distributed L1. It proves
the mechanics end-to-end; on-chain settlement is on the roadmap. See **[docs/QUANTUM.md](docs/QUANTUM.md)**
for the honest security model and the forward-looking quantum research track.

Signatures are **interoperable across languages**: a message signed by the Python SDK (dilithium-py)
verifies in the TypeScript node (@noble/post-quantum), and `examples/two-agents-demo/verify_ledger.py`
verifies the node's ledger from Python.

## Relationship to the existing web

ACP does **not** replace or delete the existing internet — it's an **additive, interoperable
layer**, the same way Web 2.0 added interactivity on top of Web 1.0 rather than demolishing it.

- **Websites and apps keep running** exactly as-is over HTTP. They can *progressively* adopt Web3
  features (wallet login, agent endpoints, on-chain payments) if and when they choose.
- **Your existing data stays where it is.** Web3 changes who controls *new* data going forward
  (self-sovereign identity); it does not retroactively seize or migrate anything. Migration is opt-in.
- **ACP is an overlay network.** It runs *over* ordinary TCP/IP, HTTP and WebSockets — an ACP
  agent is a normal internet citizen that *also* has a Web3.0 ID and wallet. Agents can still call
  any REST API, read any website, or use any cloud service as a tool.
- **The old world bridges in through adapters**, not rewrites: an existing REST API or agent can be
  wrapped as an ACP agent (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#bridging-the-existing-web)).

In short: "Web3 replaces the internet" is marketing. Realistically it's a complementary layer that
interoperates with today's web for the foreseeable future — ACP just makes *agents* first-class
citizens on top of it.

## Quickstart

**Prerequisites:** **Node 20+**, **pnpm 10+**, and **Python 3.10–3.12**.

If you don't have pnpm yet:

```bash
corepack enable pnpm        # ships with Node (run as Administrator on Windows if it errors)
# or, without admin:
npm install -g pnpm
```

**Configuration** lives in a `.env` file at the repo root — copy the template and fill in what you
need. All settings are optional; without a `.env` the node runs in-memory on the defaults.
```bash
cp .env.example .env        # Windows: copy .env.example .env
pnpm --filter @acp/node keygen   # prints ACP_NODE_SEED=… — paste it into .env
```
For **persistence (survives restarts)** set these in `.env` — otherwise the node is in-memory:
```ini
ACP_NODE_SEED=<value from keygen>                                   # stable signing identity
ACP_MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/ # your MongoDB Atlas string
ACP_MONGODB_DB=acp
```

Then run each block in its own terminal (start Terminal 1 first and leave it running).

**Terminal 1 — the ACP node**
```bash
pnpm install
pnpm --filter @acp/node dev        # reads .env → listening on http://127.0.0.1:8787
```

**Terminal 2 — the dashboard** (optional)
```bash
pnpm --filter @acp/dashboard dev   # → console on http://127.0.0.1:5173
```

**Terminal 3 — Python agents** (in an isolated virtualenv)
```bash
# First time only — create the venv and install the SDK:
# macOS / Linux:
python3 -m venv .venv && source .venv/bin/activate
# Windows (CMD):         py -3.12 -m venv .venv   then   .venv\Scripts\activate
# Windows (PowerShell):  py -3.12 -m venv .venv ;  .venv\Scripts\Activate.ps1
pip install -e "packages/acp-sdk-py[dev]"

# Every run after that — just activate and go:
#   macOS/Linux:  source .venv/bin/activate
#   Windows:      .venv\Scripts\activate
python examples/two-agents-demo/demo.py
python examples/two-agents-demo/verify_ledger.py
```

> On Windows use `py` (the Python launcher), not `python3`; `py -3.12` picks Python 3.12
> specifically. On Windows the demo commands use backslashes (`examples\two-agents-demo\demo.py`).
> The `venv` keeps the SDK's post-quantum dependencies isolated from your system Python; leave it
> later with `deactivate`. Re-running `demo.py` reuses the `bob`/`alice` handles — set
> `ACP_DEMO_SUFFIX` (e.g. `set ACP_DEMO_SUFFIX=2` on Windows) for a fresh pair, or restart the node.

Run the tests any time with `pnpm test` (36 TS tests) and `pytest packages/acp-sdk-py` (8 Python tests).

### Windows (CMD) — copy-paste

First-time setup:

```bat
cd Web3.0
python -m venv .venv
.venv\Scripts\activate.bat
pip install -e packages\acp-sdk-py
```

Terminal 1

```bat
cd Web3.0
.venv\Scripts\activate.bat
pnpm --filter @acp/node dev
```

Terminal 2

```bat
cd Web3.0
.venv\Scripts\activate.bat
pnpm --filter @acp/dashboard dev
```

Terminal 3

```bat
cd Web3.0
source .venv/bin/activate
python examples/two-agents-demo/demo.py
```

## The demo

`examples/two-agents-demo` runs the whole loop: **Alice** (a researcher) and **Bob** (a summariser)
register, agree a price via the x402 handshake, settle a post-quantum-signed payment, exchange a
task over the A2A relay, and Bob shares an ML-KEM-sealed dataset to improve Alice — all recorded on
the ledger and visible live in the dashboard.

```
─── x402: agree a price ───
  Alice requested a quote for 'summarise' → HTTP 402 Payment Required
  Bob quotes 5.00 aETH per task
─── effortless payment ───
  Alice paid Bob 5.00 aETH  (receipt rcpt_…)  settled on ledger seq #2
─── agent-to-agent task ───
  Alice → Bob  task.submit
  Bob → Alice  task.result: The next generation of the internet, Web 3.0, …
─── share data (ML-KEM sealed) ───
  Bob shared a sealed dataset; Alice decrypted: {'tip': 'Prefer primary sources', …}
```

## The console

The **LabSuite-themed** dashboard streams everything happening on the network — agents, A2A
traffic, payments, guardrail ALLOW/DENY decisions, and the live-verified ledger.

<p align="center">
  <img src="docs/media/dashboard-ledger.png" alt="Payments & ledger view: wallets and PQC-signed ledger entries with chain-verified status" width="90%" />
  <br /><sub>Payments &amp; ledger — wallet balances and the post-quantum-signed, hash-linked ledger (chain verified).</sub>
</p>

<p align="center">
  <img src="docs/media/landing-page.png" alt="ACP GitHub Pages landing page in the LabSuite editorial theme" width="90%" />
  <br /><sub>The docs landing page (<code>docs/index.html</code>), reusing the LabSuite design system.</sub>
</p>

## Modules

The node loads these by config (`config.modules`) — remove one and it's gone:

| Module | Responsibility |
| --- | --- |
| `naming` | Resolve email-like Web3.0 IDs (`alice@web3.0`) to DIDs and keys |
| `registry` | **Signed** agent registration → Web3.0 ID + DID + wallet; discovery |
| `messaging` | Signed-hello auth + A2A WebSocket relay with per-message guardrails |
| `payments` | x402 quote + signed aETH token transfers (with replay protection) |
| `guardrails` | Capability / rate-limit / spend-cap policies (ALLOW/DENY) |
| `observability` | Live event feed (+ SSE), ledger view with verification, stats |
| `consensus` | Distributed L1: PoA block proposal + peer gossip (`GET /consensus`) |
| `telegram` | GUI-managed human front door (bridge agent, admin-gated) |
| `hosted` | Run Genesis agents in-process — the node as a no-VPS host |

**Auth hardening** (kernel-level): registration is a signed envelope so only the key holder can
claim a handle and wallet; every envelope (registration, `/pay`, relay hello) passes a
**replay/freshness** check so captured requests can't be resubmitted; and a **per-IP HTTP rate
limiter** backstops the per-agent guardrails against floods. On by default, or `ACP_AUTH_ENFORCE=false`
for warn-only. Details in [docs/PROTOCOL.md](docs/PROTOCOL.md#auth--rate-limits).

## Running a node (and earning)

**Two kinds of nodes, and how many you need — the simple version:**

```
🧩  Two kinds of nodes

👑 Authority node      → runs the "chain" (confirms blocks) · the trusted core
🛰️ Relay / host node   → carries traffic + hosts AI agents · anyone can run one

🔢  How many need to be ON?

  1 node   → works, but not decentralized 😬
  4 nodes  → ✅ safe (survives 1 going offline)
  7+ nodes → 💪 strong & global

👉 Rule: keep more than ⅔ of authorities online = network stays alive
🛰️ Relay / host nodes = run as many as you want (no limit)
```

**The detail.** ACP has **two kinds of node**, with different jobs and cardinality:

### 👑 Authority nodes — the trusted core

Authority nodes run the **proof-of-authority L1**: they take turns proposing and signing the blocks
that make up the chain, and they agree on its history. **Security and finality live here** — a
majority of authorities effectively controls the chain, so the set is deliberately **small, curated,
and invite-only**.

- **What it does:** signs blocks (ML-DSA / post-quantum), orders the ledger, keeps consensus.
- **Who runs it:** you at launch, then a handful of trusted, independent partners. Not strangers —
  see **[GOVERNANCE.md](GOVERNANCE.md)**.
- **Needs:** an always-on server with good uptime; its key must be in the authority set
  (`ACP_AUTHORITIES`).
- **Earns:** a **block reward** each time it proposes a block, plus protocol fees.
- **How many:** ~4 to launch, keep **> ⅔ online**. Proposer-skip means one going offline won't stall
  the chain.

### 🛰️ Relay / host nodes — the open, scalable layer

Relay/host nodes are **permissionless** — anyone can run one, no vetting, no minimum. They carry
agent-to-agent traffic and **host agents** (one process runs many agents; see the `hosted` module and
`AgentHost`). They **cannot rewrite history**, so they need no special trust. This is the layer that
scales to millions of devices.

- **What it does:** routes messages, queues for offline agents, hosts agents & dApps in-node.
- **Who runs it:** anyone — PC, phone, tablet, or server. Download it and go (**Run a node** tab).
- **Needs:** just the node running; contribute as much RAM / as many hosted agents as you like
  (set it in the **My node** console).
- **Earns:** **hosting revenue** — the agents it runs earn their per-task fees, plus relay fees.
- **How many:** as many as you want. Zero are required for correctness; more = more capacity and
  more agents kept online.

**How many must stay online?**

| Role | Minimum | Recommended | Why |
| --- | --- | --- | --- |
| Authority | **1** works (centralized) | **4+** | BFT tolerance is 3f+1: 4 nodes survive 1 offline/faulty. Keep **> 2/3** online. |
| Relay/host | 0 required for correctness | as many as you like | More = more capacity + agents stay online; offline agents' messages queue meanwhile. |

With the **proposer-skip** (`ACP_SLOT_MS`), if the authority whose turn it is goes offline, the next
one steps in after a slot — so a single down node no longer stalls the chain. A practical launch is
**3–4 authority nodes** you and partners run, growing the set (and moving toward staking/BFT) as real
value flows.

> **Who should run authority nodes?** Run them yourself at launch, then decentralize deliberately —
> authority is trust-sensitive, relay/host nodes are open to everyone. See **[GOVERNANCE.md](GOVERNANCE.md)**.

**How operators earn — the simple version:**

```
🌐  Run a node  →  Earn money 💰

You run a node (on your PC / phone) 🖥️📱
        ⬇️
Your node helps the network 3 ways:

  1️⃣  Handles payments  →  small fee 💸
  2️⃣  Confirms blocks   →  a reward 🎁
  3️⃣  Hosts AI agents   →  earns per task 🤖
        ⬇️
All three pile into your wallet 👛  →  you earn (in aETH) 💰

More traffic = more earnings 📈
```

**The detail.** Running a node pays in aETH, off these levers (all default **0** = off):

- **Protocol fee** (`ACP_FEE_BPS`) — a basis-point cut of every payment the node settles is skimmed
  to its **treasury** account (`treasury@web3.0`). A marketplace take-rate.
- **Block reward** (`ACP_BLOCK_REWARD`) — aETH minted to the proposer's treasury for each block.
- **Hosting revenue** — a host node runs other people's agents; those agents earn their per-task
  fees directly into their wallets (a platform cut is a natural next step).

Every fee and reward is an ordinary, auditable ledger entry — visible in the dashboard and covered by
`verifyChain()`.

**Scaling to millions of nodes — the simple version:**

```
🌍  How it grows to millions of nodes

Start 🌱   A few trusted core nodes (4–7) run the chain 👑

Grow 🌿    Anyone plugs in a relay/host node — no permission 🛰️
           PCs, phones, tablets, servers all join

Scale 🌳   1,000s → 100,000s → millions of nodes 📈
           each one earns 💰 for the work it does

Result 🌐  A self-building internet of AI agents —
           no single company owns it, everyone earns
```

The **authority set stays small and curated** (that's where safety lives), while the
**relay/host layer is permissionless and unbounded** — that's the layer that scales to millions.
The path there is documented above: proposer-skip today, BFT/PoS validators and a decentralized
compute marketplace next.

## What is aETH?

**aETH is this network's own native token** — the unit agents earn and spend for network work. It's
modeled on Ethereum's economics, **not on a stablecoin**: it is deliberately *not* pegged 1:1 to the
dollar. There's no promise to redeem 1 aETH for $1. Instead its price is meant to **float with demand**
for the network — launched as a fraction of a dollar and (the goal) appreciating as more agents,
transactions, and nodes use it.

Today, in this MVP, aETH is a **closed-loop ledger credit**: minted by the node as a faucet grant,
tracked on the PQC-signed ledger in integer minor units, with no market value and no external chain
behind it yet — it proves the payment, fee, and reward mechanics end-to-end. The roadmap issues it
**on-chain as a real, freely-traded token** (its own asset, ETH-style), at which point market demand
sets the price. The fee and reward logic above stays identical either way.

> **Why not a USD-pegged stablecoin?** A 1:1 peg is a promise to hold a matching dollar reserve for
> every unit — a heavy legal/custody commitment we're not making at launch. A free-floating native
> token lets the network bootstrap cheaply and lets value accrue to holders as usage grows.

## Roadmap

Recently shipped (see [docs/PROTOCOL.md](docs/PROTOCOL.md)):

- ✅ **Distributed L1** — proof-of-authority consensus: authorities take turns proposing
  ML-DSA-signed blocks over the ledger, gossiped to peers until all agree. Try three nodes converge:
  `pnpm --filter @acp/node demo:consensus`. (`ACP_CONSENSUS=poa`)
- ✅ **Pluggable settlement** — `internal` ledger (default), `simulated` stablecoin, or a `testnet`
  ERC-20 rail that builds real transfers against an EVM testnet (never broadcasts without a signer).
- ✅ **Telegram front door** + **no-VPS `AgentHost`** — one process supervises a fleet of agents and
  keeps them online; a Telegram bot bridges humans to agents. Plus the **Genesis** create-an-agent
  wizard in the dashboard.

Still ahead:

- **Real mainnet settlement** — add a funded signer to the testnet rail (deliberately out of the box)
- **BFT/PoS validators + state-machine replication** — beyond round-robin PoA and a replicated log
- **Per-developer authentication & multi-tenant scoping** — today the dashboard scopes the *Hosted
  dApps* view by ownership in the UI (owner sees all; a developer sees only what they published), but
  the read APIs are still open. A real boundary needs each developer to authenticate (a signed
  identity / API key) so the node can enforce "you only see and manage your own dApps" server-side.
- **Decentralized compute marketplace** — agents earn hosting by joining the network
- **Adapters** to import existing agents onto ACP
- **Quantum research track** — clearly labelled forward-looking work

## License

MIT © 2026 sanjaydoc. See [LICENSE](LICENSE).
