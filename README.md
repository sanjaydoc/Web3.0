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
| 4 | No agentic payments | **payments** module — x402 handshake + signed stablecoin transfers |
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

## Quickstart

**Prerequisites:** **Node 20+**, **pnpm 10+**, and **Python 3.10–3.12**.

If you don't have pnpm yet:

```bash
corepack enable pnpm        # ships with Node (run as Administrator on Windows if it errors)
# or, without admin:
npm install -g pnpm
```

Then run each block in its own terminal (start Terminal 1 first and leave it running).

**Terminal 1 — the ACP node**
```bash
pnpm install
pnpm --filter @acp/node dev        # → listening on http://127.0.0.1:8787
```

**Terminal 2 — the dashboard** (optional)
```bash
pnpm --filter @acp/dashboard dev   # → console on http://127.0.0.1:5173
```

**Terminal 3 — Python agents** (in an isolated virtualenv)
```bash
# macOS / Linux:
python3 -m venv .venv && source .venv/bin/activate
# Windows (CMD):         py -3.12 -m venv .venv   then   .venv\Scripts\activate
# Windows (PowerShell):  py -3.12 -m venv .venv ;  .venv\Scripts\Activate.ps1

pip install -e "packages/acp-sdk-py[dev]"
python examples/two-agents-demo/demo.py
python examples/two-agents-demo/verify_ledger.py
```

> On Windows use `py` (the Python launcher), not `python3`; `py -3.12` picks Python 3.12
> specifically. On Windows the demo commands use backslashes (`examples\two-agents-demo\demo.py`).
> The `venv` keeps the SDK's post-quantum dependencies isolated from your system Python; leave it
> later with `deactivate`. Re-running `demo.py` reuses the `bob`/`alice` handles — set
> `ACP_DEMO_SUFFIX` (e.g. `set ACP_DEMO_SUFFIX=2` on Windows) for a fresh pair, or restart the node.

Run the tests any time with `pnpm test` (36 TS tests) and `pytest packages/acp-sdk-py` (8 Python tests).

## The demo

`examples/two-agents-demo` runs the whole loop: **Alice** (a researcher) and **Bob** (a summariser)
register, agree a price via the x402 handshake, settle a post-quantum-signed payment, exchange a
task over the A2A relay, and Bob shares an ML-KEM-sealed dataset to improve Alice — all recorded on
the ledger and visible live in the dashboard.

```
─── x402: agree a price ───
  Alice requested a quote for 'summarise' → HTTP 402 Payment Required
  Bob quotes 5.00 aUSD per task
─── effortless payment ───
  Alice paid Bob 5.00 aUSD  (receipt rcpt_…)  settled on ledger seq #2
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
| `registry` | Agent registration → Web3.0 ID + DID + wallet; discovery |
| `messaging` | Signed-hello auth + A2A WebSocket relay with per-message guardrails |
| `payments` | x402 quote + signed stablecoin transfers on the ledger |
| `guardrails` | Capability / rate-limit / spend-cap policies (ALLOW/DENY) |
| `observability` | Live event feed (+ SSE), ledger view with verification, stats |

## Roadmap

- **No-VPS hosting** — agents earn hosting by joining the network (decentralized compute marketplace)
- **Telegram bot** front door + **Genesis** create-an-agent-from-a-prompt app
- **On-chain settlement** — internal ledger → multi-chain testnet stablecoins (x402 / AP2)
- **Adapters** to import existing agents onto ACP
- **Quantum research track** — clearly labelled forward-looking work

## License

MIT © 2026 sanjaydoc. See [LICENSE](LICENSE).
