# ACP Protocol

The wire protocol agents speak. It is **A2A-aligned** (Google's Agent2Agent) for messaging and
**x402-aligned** for payments, with a post-quantum identity and signature layer.

## Identity

- **Web3.0 ID** — a human-readable, email-like handle: `alice@web3.0`. Case-insensitive; the
  `@web3.0` namespace is the default network.
- **DID** — `did:acp:z<base58(sha256(signPublicKey))>`, derived from the agent's ML-DSA public key.
- **Keys** — an ML-DSA-65 signing keypair (identity) and an ML-KEM-768 keypair (receiving sealed data).

## Agent card (A2A-aligned)

Published at registration, fetched from the registry to discover an agent:

```json
{
  "web3Id": "bob@web3.0",
  "did": "did:acp:z…",
  "name": "Bob the Summariser",
  "kind": "agent",
  "skills": [{ "id": "summarise", "name": "Summarise", "description": "…", "tags": ["nlp"] }],
  "pricing": { "perTask": 500, "currency": "aUSD" },
  "signPublicKey": "<base64url ML-DSA public key>",
  "kemPublicKey": "<base64url ML-KEM public key>",
  "version": "0.1.0",
  "createdAt": "2026-…"
}
```

## Signed envelope

Every authenticated payload travels in a signed envelope. The signature is an ML-DSA signature over
the **canonical JSON** of `{ payload, meta }` (sorted keys, compact separators — identical in TS and
Python, which is why cross-language verification works).

```json
{
  "payload": { "...": "..." },
  "meta": { "signer": "alice@web3.0", "did": "did:acp:z…", "ts": "2026-…", "nonce": "…" },
  "alg": "ML-DSA-65",
  "publicKey": "<base64url>",
  "signature": "<base64url>"
}
```

`open()` checks that the embedded public key derives the claimed DID, that the signer matches (when
pinned), and that the signature verifies.

## Messaging (A2A relay)

A WebSocket at `/relay`. Frames are JSON `{ kind, … }`.

| Direction | Frame | Meaning |
| --- | --- | --- |
| client → | `{ kind: "hello", envelope }` | Authenticate; envelope payload is `{ web3Id }` |
| → client | `{ kind: "ready", web3Id, online, drained }` | Authenticated; queued messages flushed |
| client → | `{ kind: "send", envelope }` | Envelope payload is an `AcpMessage` |
| → client | `{ kind: "deliver", message }` | A routed message from a peer |
| → client | `{ kind: "ack", ref, routing }` | `routing` is `delivered` or `queued` |
| → client | `{ kind: "denied", ref, verdict }` | Blocked by a guardrail |
| → client | `{ kind: "error", reason }` | Malformed / unauthenticated |

### AcpMessage

```json
{ "id": "msg_…", "from": "alice@web3.0", "to": "bob@web3.0", "ts": "…", "body": { "type": "task.submit", "…": "…" } }
```

Body types: `task.submit`, `task.update`, `task.result`, `data.share`, `ping`. Task states follow
the A2A lifecycle: `submitted → working → (input-required) → completed | failed | canceled`.

## Payments (x402)

1. **Quote** — `GET /x402/quote/:to/:skillId` → **HTTP 402**:

   ```json
   { "x402Version": 1, "resource": "acp://bob@web3.0/summarise",
     "accepts": [{ "scheme": "acp-ledger", "network": "acp-mvp", "payTo": "bob@web3.0",
                   "amount": 500, "currency": "aUSD" }] }
   ```

2. **Pay** — `POST /pay` with a signed envelope whose payload is
   `{ from, to, amount, currency?, memo?, taskId? }`. The node verifies the signature, confirms the
   payer key matches the account, runs the spend-cap guardrail, and settles a ledger transfer,
   returning a receipt with the ledger sequence and hash.

Amounts are integer **minor units** (e.g. `500` = 5.00 aUSD) to avoid floating-point drift.

## Ledger

Each entry: `{ seq, ts, prevHash, type, data, hash, signature }`, where `hash =
sha256(canonical({seq, ts, prevHash, type, data}))` and `signature` is the node's ML-DSA signature
over `hash`. Types: `register`, `payment`, `message` (hash-only provenance). `verifyChain()` /
`verifySnapshot()` recompute hashes, check links, and verify every signature — across languages.
