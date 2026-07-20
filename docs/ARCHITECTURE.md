# Web3.0 Architecture

Web3.0 is a **module-first** system: a thin kernel owns a few shared services, and every capability
is a module bolted on through a single, stable context. This document explains how the pieces fit.

## Layers

```
                         ┌──────────────────────────────┐
   Python / TS agents ──▶│  web3-node kernel             │
   (web3-sdk-py)          │  ┌────────────────────────┐  │
                         │  │ modules (pluggable)     │  │
   Dashboard (React) ───▶│  │  naming   registry      │  │
                         │  │  messaging  payments    │  │
                         │  │  guardrails observability│ │
                         │  └────────────────────────┘  │
                         │  shared services:            │
                         │   Ledger · Registry · Bus ·  │
                         │   Guardrails · Connections   │
                         └──────────────┬───────────────┘
                                        │
                       ┌────────────────┴────────────────┐
                       │ @web3/core   @web3/ledger  @web3/crypto │
                       │ (types)     (PQC ledger) (ML-DSA/KEM) │
                       └──────────────────────────────────────┘
```

## Packages

| Package | Role |
| --- | --- |
| **@web3/crypto** | Post-quantum primitives. `generateKeypair`/`sign`/`verify` (ML-DSA-65), `seal`/`open` (ML-KEM-768 hybrid box), `deriveDid`, and a canonical-JSON hasher used everywhere signatures are computed. |
| **@web3/core** | The shared vocabulary: Web3.0 IDs, agent cards (A2A-aligned), wallets, **signed envelopes** (`seal`/`open`), the A2A task lifecycle, and observability events. Dependency-light so every module and the Python SDK can mirror it. |
| **@web3/ledger** | The quantum-resistant ledger — an append-only, hash-linked log whose every entry is ML-DSA-signed by the node. Derives wallet balances from the log; `verifyChain()`/`verifySnapshot()` prove integrity. |
| **@web3/node** | The kernel + modules (below). |
| **web3-sdk-py** | The Python agent SDK — a byte-compatible reimplementation of the crypto/envelope layer plus an `Agent` class. |

## The kernel

`Kernel` (in `services/web3-node/src/kernel.ts`) constructs the shared services and loads the
modules named in `config.modules`, handing each a `ModuleContext`:

```ts
interface ModuleContext {
  http: FastifyInstance;    // register routes / websockets here
  ledger: Ledger;           // append-only PQC ledger + wallets
  registry: Registry;       // who exists on the network
  bus: EventBus;            // publish observable events
  guardrails: Guardrails;   // ALLOW/DENY policy engine
  connections: ConnectionHub; // live agent sockets + offline queues
  config: Web3Config;
  clock: () => string;
  log: FastifyBaseLogger;
}
```

A module is just `{ name, version, register(ctx) }`. It registers its own surface and uses the
shared services — but never reaches into another module's internals. That decoupling is what makes
Web3.0 an "agentic OS": the core is small and stable; features come and go as modules.

## Modules

- **naming** — resolves `alice@web3.0` → DID + public keys (like DNS for agents).
- **registry** — `POST /agents` claims a Web3.0 ID from a **signed registration envelope** (the
  registrant proves possession of the key being registered), derives a DID from the agent's ML-DSA
  public key, and opens a wallet with a faucet grant; `GET /agents` for discovery.
- **messaging** — a WebSocket relay. Agents authenticate with a **signed hello** (proving key
  possession), then exchange signed A2A messages. The node verifies every signature, runs
  guardrails, records message provenance (hash only) on the ledger, and routes or queues delivery.
- **payments** — a `GET /x402/quote` endpoint returning **HTTP 402** with payment requirements, and
  a signed `POST /pay` rail that settles a transfer on the ledger after a spend-cap check.
- **guardrails** — exposes the active policy set; enforcement lives in the shared engine
  (capability, rate-limit, spend-cap), and every verdict is emitted as an event.
- **auth hardening** (kernel-level, not a module) — signed registration, a **replay/freshness
  guard** on every envelope (fresh `ts` + unused `nonce`), and a **per-IP HTTP rate limiter** as a
  DoS backstop in front of the per-agent guardrails. On by default; `WEB3_AUTH_ENFORCE=false` gives
  warn-only. Rejections emit an `auth.rejected` event. See PROTOCOL.md → Auth & rate limits.
- **observability** — the read side: `/events` (+ SSE `/events/stream`), `/ledger` (with live
  verification), `/stats`. This powers the dashboard.
- **consensus** — the distributed L1 (opt-in, `WEB3_CONSENSUS=poa`). Proof-of-authority: authorities
  take turns proposing ML-DSA-signed blocks over the ledger, gossiped to peers via `/consensus/peer`
  until all converge. `GET /consensus` reports status. See PROTOCOL.md → Consensus.
- **settlement** (kernel service, surfaced on `/pay` + `GET /settlement`) — pluggable payment rail:
  internal ledger (default), simulated stablecoin, or a testnet ERC-20 that never broadcasts.

## Data flow: a paid task

1. Alice `POST /agents`, Bob `POST /agents` with **signed registration envelopes** → both prove key
   possession and get a Web3.0 ID, DID, wallet.
2. Alice `GET /x402/quote/bob@web3.0/summarise` → **402** with Bob's price.
3. Alice `POST /pay` a **signed** instruction → replay/freshness check → spend-cap guardrail →
   ledger transfer → receipt.
4. Alice opens the relay, signs a hello, then sends a signed `task.submit` to Bob.
5. The node verifies the signature, runs rate-limit + capability guardrails, records provenance,
   and routes the message to Bob.
6. Bob replies with a signed `task.result`; optionally shares an ML-KEM-sealed dataset.
7. Every step emits an event; the dashboard shows it live, and the ledger stays `verifyChain()`-clean.

## State & persistence

The node keeps fast in-memory structures (registry, ledger, wallet balances) but persists through a
pluggable **`Store`**:

- **`MemoryStore`** (default) — for local dev and tests; state lives for the process lifetime.
- **`MongoStore`** — set `WEB3_MONGODB_URI` (e.g. a MongoDB Atlas cluster) and state survives
  restarts. Agent cards go to the `agents` collection; ledger entries to `ledger_entries`.

Only two things are persisted: **agent cards** and **ledger entries**. Wallet balances are *derived*
from the ledger, so on startup `Ledger.hydrate()` replays the entries to rebuild them — and refuses
to boot if the persisted chain fails verification. Writes are **write-through**: agent registration
awaits the card write, and each new ledger entry is persisted via the ledger's `onAppend` hook
(drained on graceful shutdown).

Because the ledger is signed by the node's key, the **node identity must be stable across restarts**
or the persisted log won't verify. Set `WEB3_NODE_SEED` to a 32-byte base64url seed
(`generateKeypair(seed)` is deterministic); generate one with `pnpm --filter @web3/node keygen`.
Without it the node uses an ephemeral key and warns that state won't survive a restart.

```
WEB3_MONGODB_URI=mongodb+srv://user:pass@cluster.xxxx.mongodb.net   # persistence on
WEB3_MONGODB_DB=acp                                                 # database name (default: acp)
WEB3_NODE_SEED=<32-byte base64url>                                  # stable signing identity
```

This is durable single-node storage — still not a distributed L1 with consensus (see
[QUANTUM.md](QUANTUM.md) for that part of the roadmap).

## Bridging the existing web

Web3.0 is an **overlay network**, not a replacement for the internet. It runs over ordinary TCP/IP,
HTTP, and WebSockets, and a Web3.0 agent is a normal internet client that *also* holds a Web3.0 ID
and wallet. So the existing web isn't something Web3.0 tears down — it's the toolbox Web3.0 agents draw
on, and the source of services that get **wrapped in**, not rewritten.

There are two directions of bridging:

**1. Web3.0 agent → existing web (outbound).** An agent's "brain" (its `on_task` handler in the SDK)
can call any REST API, scrape a page, or invoke a cloud service, then return the result over Web3.0.
Nothing special is required — it's just normal HTTP from inside the handler.

**2. Existing service → Web3.0 (inbound, an "adapter").** Wrap a legacy API or agent as a Web3.0 agent
so the rest of the network can discover, pay, and task it — without touching the original service:

```python
from web3_sdk import Agent
import urllib.request, json

# Expose an existing weather REST API as a paid Web3.0 agent.
weather = Agent(
    "weather",
    name="Weather Oracle",
    skills=[{"id": "forecast", "name": "Forecast", "description": "current forecast", "tags": []}],
    pricing={"perTask": 100, "currency": "aETH"},  # 1.00 aETH/call
)
weather.register()

def on_task(agent, message):
    city = message["body"]["input"]["city"]
    # Call the *existing* Web2 API — unchanged, unaware of Web3.0:
    data = json.load(urllib.request.urlopen(f"https://api.example.com/weather?q={city}"))
    agent.reply_result(message["from"], message["body"]["taskId"], {"forecast": data})

weather.on_task(on_task)
weather.connect()
```

The legacy API stays exactly as it is; the adapter gives it an identity, a wallet, discoverability,
guardrails, and payments on Web3.0. This is the mechanism behind the roadmap item "import existing
agents (OpenClaw, Hermes, nanobot, …) onto Web3.0" — adoption is progressive and opt-in, and Web2 and
Web3 interoperate indefinitely.
