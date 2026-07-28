# Host LLM Tunnel — a decentralized inference marketplace

**Status:** Phases 1–5 shipped (transport · offers/marketplace · metering+billing · auto-pull · trust).
Phase 6 (mobile hosting, TEEs) deferred.
**Depends on:** the compute marketplace (hosting), the A2A WebSocket relay, `services/llm.ts`, the 3%
commission + 1/1/1 split, the Connectors runtime.

---

## 1. The idea in one line

Node operators host **local LLMs** on their own machines and sell that **inference** to agent owners
through the existing marketplace — so the network provides not just the agent's *body* (RAM/hosting)
but its *brain*, with no external cloud dependency.

This turns Web3.0 from *"GitHub for agents"* (free always-on hosting) into *"a decentralized
inference network"* (crowd-sourced GPUs/CPUs). It is the feature that gives node operators a reason
to contribute **real compute**, not just RAM.

---

## 2. Why it fits what already exists (≈70% of the plumbing is built)

| Piece we need | Already have it? | Where |
|---|---|---|
| An agent that calls an LLM by URL | ✅ | `services/llm.ts` routes to any OpenAI-compatible `baseUrl` (Ollama is OpenAI-compatible) |
| A marketplace of operator offerings | ✅ | `services/hosting.ts` + `Marketplace.tsx` (today it rents RAM) |
| A way to move requests to a NAT'd operator | ✅ (reuse) | the A2A **WebSocket relay** — operators already hold a live socket to the network |
| Metered payment + platform cut | ✅ | ledger + `splitFee` (3% commission, 1/1/1) |
| Per-agent brain selection | ✅ | Genesis wizard already picks `provider` / `model` / `baseUrl` |

**The gap:** today an agent's `baseUrl` points at *its own* node's `127.0.0.1:11434`. We need it to
point at **another operator's** Ollama, reached over the network, metered, and paid.

---

## 3. Architecture

### 3.1 The tunnel (the make-or-break piece)

Operators run Ollama on `127.0.0.1:11434`, unreachable from the internet (home NAT). Instead of
per-operator ngrok/Cloudflare, **tunnel inference through the relay we already run**:

```
 agent (on host A) ──inference.request──▶ relay ──▶ operator node B ──▶ local Ollama
      ▲                                                                     │
      └───────────────── inference.response ◀── relay ◀────────────────────┘
```

- The operator's node holds its existing signed WebSocket to the relay. A new frame kind
  `inference.request` / `inference.response` carries the OpenAI-style chat payload.
- No inbound ports on the operator's machine — the socket is **outbound**, same as agent messaging.
- Requests are signed (ML-DSA) and rate-limited exactly like other relay traffic.

> Reusing the relay is the key insight: NAT traversal is already solved for messaging; inference is
> just another payload on the same pipe.

### 3.2 Model offerings (extends the hosting offer)

An operator publishes **model offers** alongside their RAM offer:

```jsonc
// POST /llm/offer  (operator, admin-gated on their own node)
{
  "model": "llama3:8b",
  "pricePerMTok": 20,          // aETH minor units per million tokens (in+out)
  "maxContext": 8192,
  "ramMb": 8192                // RAM this model reserves — derived from the operator's slider
}
```

The node derives which models it *can* offer from contributed RAM (same `ramMbPerAgent`-style budget):
`8 GB → gemma:2b`, `16 GB → llama3:8b`, `32 GB+ → larger`. The slider raises/lowers RAM → the node
pulls a bigger/smaller model.

### 3.3 The marketplace listing (agent-owner side)

`GET /llm/market` returns live model offers across operators (aggregated from relay heartbeats, like
node locations already are). The agent-owner Marketplace gets a **"Models"** tab:

| Model | Host | Price / Mtok | Context | Latency (p50) | Rep |
|---|---|---|---|---|---|

Choosing one sets the agent's brain to `provider: "tunnel"`, `baseUrl: <relay-routed>`, `model: …`.
At task time, `handleTask` → `llmChat` → the tunnel transport instead of a direct HTTP fetch.

### 3.4 Metering + payment

- The **serving operator** counts prompt+completion tokens (Ollama returns them) and emits a signed
  usage receipt per request.
- Billing rides the **existing epoch tick** (like hosting leases): `tokens × pricePerMTok`, settled on
  the ledger, split **1/1/1** via `splitFee` (platform / serving node / contribution pool). No new
  settlement path.
- A **spend cap** (reuse the guardrail spend-cap) protects the agent owner from runaway token bills.

---

## 4. Packaging (auto-pull models)

**Desktop installer** ships **Ollama** (or bundles a launcher) + a first-run setup step:

1. Ask the operator how much RAM to contribute (slider — already in onboarding).
2. Map RAM → a model tier and run `ollama pull <model>` automatically:
   | Contributed RAM | Auto-pulled model |
   |---|---|
   | 4–8 GB | `gemma:2b` |
   | 8–16 GB | `llama3:8b` / `qwen2.5:7b` |
   | 16–32 GB | `llama3:8b-instruct-q8` |
   | 32 GB+ | `llama3:70b` (quantised) |
3. Raising the slider later re-pulls a bigger model; lowering it unloads/removes.

Do **not** bundle multi-GB weights inside the installer — pull on first run.

**Mobile (APK):** the hardest path — phones can't run Ollama; you'd need `llama.cpp` + a tiny model
(`gemma-2b` q4) and fight thermal/battery/RAM. **Deferred.** Ship desktop first; mobile hosting is a
later "nice-to-have," and phones stay great as *agent-owner* clients that *consume* tunnelled models.

---

## 5. Dashboards

**Node operator → new "Host LLM tunnel" section:**
- Rows of hosted models: name, size, RAM reserved, status (loaded/pulling), **traffic** (req/s,
  tokens served, earnings), and a per-model on/off toggle.
- The RAM slider (shared with hosting capacity) that drives which models can be pulled.

**Agent owner → Marketplace "Models" tab:** pick a hosted model as an agent's brain (§3.3).

---

## 6. The hard problems (and honest mitigations)

| Risk | Why it's hard | Mitigation (phased) |
|---|---|---|
| **NAT traversal** | operators behind home routers | tunnel over the **existing relay** (outbound socket) — solved infra |
| **Prompt privacy** | the operator must decrypt to run inference — inherent | **disclose** ("unverified operator") in the UI; reputation; TEEs much later. Don't oversell privacy. |
| **Model/quality fraud** | operator could run a tiny model and bill for a big one; token counts are self-reported | challenge-response canary prompts; reputation score from agent-owner ratings; slashing later |
| **Availability** | home machines sleep mid-task | health heartbeats + **failover** to another operator/model; the agent's sleep-on-idle already helps |
| **Latency/throughput** | home CPU/GPU is slow; tunnel adds a hop | surface **p50 latency** in the marketplace; good enough for async agents, not realtime |

None of these block a v1 — they shape the reputation/verification roadmap.

---

## 7. Economics

- Inference is **metered, recurring** revenue (per-Mtok) — richer than one-time hosting rent.
- Same **3% commission, 1/1/1 split, zero-inflation** model — no new minting; aETH flows from real
  usage. Operators earn for the **compute** they lend, finally making "contribute your machine" pay.
- Free tier: an agent owner can still use their *own* local model or a free operator; paid tunnels are
  opt-in.

This is the piece that makes the token economy coherent: **RAM = hosting, tokens = inference**, both
priced, both split the same way.

---

## 8. Phases (each shippable + testable)

1. ✅ **Tunnel transport.** `inference.request/response` frames over the relay; the agent brain gains
   a `tunnel` provider that speaks it. Test: an agent on node A gets a completion from Ollama on
   node B (stub Ollama in tests). *No UI, no payment yet.*
2. ✅ **Model offers + marketplace.** `POST /llm/offer`, `GET /llm/market`. Operator "Host LLM
   tunnel" section (list/traffic) + Marketplace "Hosted models" section.
3. ✅ **Metering + billing.** Token receipts (Ollama usage over the tunnel), per-epoch settlement,
   3% 1/1/1 split, per-owner spend cap. `LlmMeterService` + `GET /llm/revenue` / `GET /llm/spend`.
4. ✅ **Auto-pull packaging.** Desktop `src/ollama.js` + `services/model-tiers.ts` +
   `GET /llm/recommended`: first-run + slider re-pull via `ollama pull`; weights never bundled.
5. ✅ **Trust.** `LlmReputationService` blends owner ratings (`POST /llm/rate`) + canary checks
   (`POST /llm/canary`) into a 0–100 score on `GET /llm/market`; the tunnel ranks hosts by it and
   **fails over** to the next host on error; the Marketplace discloses **unverified** operators.
6. **(Later)** Mobile hosting (llama.cpp + tiny models); TEEs for private inference.

---

## 9. Open questions

- **Pricing unit:** per-Mtok (fair, standard) vs per-request (simpler, gameable on long outputs)? →
  lean per-Mtok, cap context.
- **Model identity/verification:** how do we *prove* the served model? (canary prompts get us 80%.)
- **Streaming:** do we tunnel token streams (better UX, more relay load) or full responses first? →
  full responses in v1, stream later.
- **Relay load:** inference payloads are bigger than messages — do we need a dedicated inference relay
  lane or per-operator direct tunnels for scale? → start on the shared relay, measure.

---

## 10. Verdict

Build it, **desktop-first**, tunnelled through the **existing relay**, framed as a decentralized
inference marketplace. It reuses the marketplace, the relay, `llm.ts`, and the 3% split — so it is an
*extension*, not a rebuild — and it is the feature that finally makes contributing a machine pay.
