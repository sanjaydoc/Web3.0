# @web3/erc8004

[ERC-8004 "Trustless Agents"](https://eips.ethereum.org/EIPS/eip-8004) for Web3.0 — three registries
that give an agent a verifiable **identity**, a portable **reputation**, and independent
**validation**, so external agents and indexers built on the standard can discover and trust Web3.0
agents. Ledger-backed, with a seam to real on-chain registries.

## The three registries

| Registry | Class | What it holds |
|----------|-------|---------------|
| **Identity** | `IdentityRegistry` | Agents as transferable tokens (`agentId`) resolving to a registration file. The anchor the others defer to for authorization. |
| **Reputation** | `ReputationRegistry` | Bounded feedback attestations (score 0–100) with tags; aggregate summaries. |
| **Validation** | `ValidationRegistry` | Verification requests + validator responses, keyed by a `dataHash`. |

## Bridge to Web3.0's post-quantum identity

ERC-8004 assumes an EVM address is the agent's identity. Web3.0 agents have a **post-quantum DID**
(ML-DSA), so the registry derives a **stable EVM-shaped `agentAddress`** from the DID (or binds a real
wallet later). The registration file carries both — the ERC-8004 `registrations` pointer *and* the
`web3.did` / `signPublicKey`. "An agent's wallet is its identity, bank account, and reputation system
in one" — here the wallet address is derived from a quantum-resistant key.

```ts
import { IdentityRegistry, ReputationRegistry, buildRegistrationFile } from '@web3/erc8004';

const clock = () => new Date().toISOString();
const identity = new IdentityRegistry(clock);

const alice = identity.newAgent({ agentDomain: 'alice@web3.0', did: 'did:web3:zAlice' });
// alice.agentId === 1, alice.agentAddress derived deterministically from the DID

const rep = new ReputationRegistry(identity, clock);
rep.giveFeedback({ agentId: alice.agentId, client: '0xClient', score: 95, tag1: 'accuracy' });
rep.summary(alice.agentId); // { count: 1, averageScore: 95, byTag: { accuracy: {…} } }

const file = buildRegistrationFile(alice, {
  agentRegistry: 'eip155:84532:0xRegistry',   // or web3:web3.0:node:… for ledger mode
  name: 'Alice', description: 'A helpful agent', version: '0.1.0',
});
```

## Authorization pattern

Reputation and Validation hold a reference to the Identity Registry and check it before any write:
the agent must exist; only its owner may respond to feedback; only the original client may revoke;
only the named validator may respond to a validation request. That deferral is the ERC-8004 model.

## Test

```
pnpm --filter @web3/erc8004 test
```
