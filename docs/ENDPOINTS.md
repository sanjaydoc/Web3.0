# Web3.0 node — API endpoints

Every HTTP route the node exposes, grouped by area, with the dashboard view/metric each one powers.
The node is one process; a **desktop app**, the **GCP authority**, and any **self-hosted node** all
serve this same surface and converge on the **one shared chain**. Base URL is the node
(`http://127.0.0.1:8787` locally, or the network's authority such as `https://<authority>`).

## The numbers the dashboard shows (and where they come from)

| Dashboard field (Overview / Network) | Endpoint | Value |
|---|---|---|
| **Nodes online** | `GET /stats` → `nodes` | live nodes heard from via fresh signed heartbeats (network-wide) |
| **Agents** | `GET /stats` → `agents` | real agents across **all** nodes (Σ each node's hosted agents − one treasury per node) |
| **Agents online** | `GET /stats` → `online` | connected agents summed across all nodes |
| **Value in network** | `GET /stats` → `totalValue` | sum of all wallet balances minus burned |
| **Ledger entries** | `GET /stats` → `ledgerEntries` / `GET /ledger` → `size` | committed entries on the chain |
| **Ledger integrity** | `GET /stats` → `ledgerVerified` | chain hash-link verification |
| **Recent activity** | `GET /events` (+ `GET /events/stream` SSE) | live event feed (tx.submitted, agent.registered, …) |

## Observability

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness `{ok:true}` |
| GET | `/stats` | headline network-wide metrics (see table above) |
| GET | `/events` | recent event buffer (`?limit=`) |
| GET | `/events/stream` | Server-Sent-Events live stream |
| GET | `/ledger` | ledger head, size, chain verification, wallets, recent entries |

## Registry & discovery

| Method | Path | Purpose |
|---|---|---|
| POST | `/agents` | register an agent (signed envelope) + open its wallet |
| GET | `/agents` | list agents on this node + count |
| GET | `/agents/:web3Id` | one agent's card |
| GET | `/resolve/:web3Id` | resolve an id to its card/DID |
| GET | `/wallets/:web3Id` | a wallet's balance |
| GET | `/skills` | skills advertised across registered agents |

## Accounts & identity

| Method | Path | Purpose |
|---|---|---|
| POST | `/accounts/signup` | mint `local@web3.0` + token (forwarded to the authority on a follower) |
| GET | `/accounts/me` | resolve the signed-in account from its token |
| GET | `/accounts/me/earnings` | the signed-in account's own wallet + income |
| POST | `/accounts/key` | bind/rotate this device's ML-DSA signing key on-chain |
| GET | `/accounts` | list accounts (admin) |

## Transactions & payments

| Method | Path | Purpose |
|---|---|---|
| POST | `/tx` | submit an account-signed transfer (gossiped to an authority to seal) |
| GET | `/tx/nonce/:account` | next nonce + on-chain bound pubkey for an account |
| POST | `/pay` | x402-style pay-per-task ledger transfer |
| GET | `/x402/quote/:to/:skillId` | price quote for a skill |
| POST | `/relay` | route a signed A2A message between agents |

> A transfer shows in **Recent activity** the instant it's submitted, and in **Payments & ledger**
> as a `pending` row until an authority seals it into a block — then it becomes a sealed entry that
> replicates to every node's `/ledger`. (This is why an isolated node with no reachable authority
> shows transfers as pending: they can't be sealed until it joins the shared chain.)

## Consensus & network

| Method | Path | Purpose |
|---|---|---|
| GET | `/consensus` | consensus status (mode, authorities, height, peers, turn) |
| WS | `/consensus/peer` | peer gossip: blocks + contribution heartbeats |
| GET | `/node` | node role, treasury id, uptime, auth visibility, earnings, traffic, consensus, resources, limits |
| GET/PUT | `/node/limits` | node resource limits |

## Operator console (node owner)

| Method | Path | Purpose |
|---|---|---|
| GET | `/operator/contribution` | this node's Proof-of-Contribution score / projected reward |
| GET/PUT | `/operator/economics` | fee/burn/block-reward/stake params (admin) |
| POST | `/operator/stake` · `/operator/unstake` | stake toward authority / begin cooldown exit |
| POST | `/operator/collect` | sweep the node treasury into the owner's wallet (admin) |
| GET/PUT | `/operator/storage` | persistence settings |
| PUT | `/operator/location` · GET `/operator/locations` | opt-in node map position / all advertised positions |
| POST | `/operator/authority/request` · GET `/operator/authority/mine` | ask to become an authority / my request |
| GET | `/operator/authority/requests` · POST `/operator/authority/decide` | pending requests / approve (admin) |

## Connectors, guardrails, hosted dApps, Telegram, settlement

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/connectors` · `/connectors/:id` | custom connector registry |
| GET | `/guardrails` | active policies + recent ALLOW/DENY decisions |
| GET/POST | `/hosted` · `/hosted/launch` · `/hosted/stop` | operator-hosted dApps (per-owner scoped) |
| GET/POST | `/telegram` · `/telegram/config` · `/telegram/start` · `/telegram/stop` | in-node Telegram bot |
| GET | `/settlement` | settlement mode / network |

---

**One shared network guarantee.** A node built with `desktop/network.json` (or `WEB3_CONSENSUS=poa`
+ authorities + peers) joins the single shared chain: it replicates the full ledger, gossips
heartbeats (so its agents/nodes count network-wide), and forwards signed transactions to an
authority to be sealed. There are no island nodes when a node is pointed at the shared authority —
verified by `test/two-node.test.ts` (writes converge on both nodes) and `test/stats-metrics.test.ts`
(the dashboard's `/stats` reports network-wide, treasury-excluded counts).
