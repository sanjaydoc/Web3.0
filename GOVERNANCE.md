# Governance

How ACP (Web3.0) is secured and decided today, and how that decentralizes over time. This is written
honestly: the network is an **MVP proof-of-authority (PoA)** chain, not yet a byzantine-fault-tolerant
or fully permissionless L1. What follows is both the current reality and the intended path.

## Two node roles, two trust levels

| Role | Trust | Who runs it |
| --- | --- | --- |
| **Authority node** | High — signs and orders blocks. A majority controls the chain. | Few, curated, invite-only. |
| **Relay / host node** | Low — routes traffic and hosts agents; cannot rewrite history. | Anyone, permissionless, unlimited. |

The security of the network **is** the honesty of its authority set. That is why the authority set is
kept small and curated, while the relay/host layer is open to the whole world.

## Who runs authority nodes

Authority is granted in phases. **Do not hand it to strangers early.**

1. **Launch** — the founder(s) run the initial authority set (recommended **4 nodes**, on separate
   machines/regions where possible). Centralized-but-honest is the correct, normal starting point for
   a new network. Keep **more than ⅔ online**.
2. **Early growth** — add **2–3 trusted partners** as authorities: independent people/orgs, in
   different regions, each accountable and able to keep real uptime.
3. **Mature** — migrate to a **staked validator set** (PoS/BFT), where authorities lock a stake and are
   slashed for misbehavior. Trust becomes enforced by protocol, not reputation. (Roadmap.)

### Criteria to become an authority

- **Skin in the game** — a name, reputation, or business to lose.
- **Independence** — not controlled by, or colluding with, existing authorities.
- **Diversity** — different operators, organizations, and jurisdictions.
- **Reliability** — a real always-on server, not a sleeping laptop.
- **Accountability** — a reachable operator who answers for the node.

One party quietly controlling several "different" authorities defeats the purpose and is treated as a
single authority for trust purposes.

## Who runs relay / host nodes

**Anyone.** No permission, no minimum, no vetting. Relay/host nodes carry traffic and host agents;
they earn fees but cannot alter the block history. This is the layer that scales to millions of
devices — PCs, phones, tablets, servers. Onboarding is: download the node, run it. See the README's
**Running a node** section.

## How the chain stays safe and live

- **Safety** — every block is signed with a post-quantum (ML-DSA) key by the authority whose turn it
  is; validators reject anything else. Tampering is caught by `verifyChain()`.
- **Liveness** — round-robin proposing with **proposer-skip** (`ACP_SLOT_MS`): if the in-turn
  authority is offline, the next steps in after a slot, so one down node cannot stall the chain.
- **Fork choice** — longest valid chain, preferring the most in-turn history; deterministic, so honest
  nodes converge.

**Threat model, stated plainly:** under PoA, a **majority of authorities that collude** could reorder
or censor. Mitigations today are curation (few, accountable authorities) and diversity. The durable
fix is the PoS/BFT migration on the roadmap.

**Access control, stated plainly:** write actions on a node (launching agents, publishing dApps,
changing settings) are gated by an **admin token** (`ACP_ADMIN_TOKEN`); read APIs are open. The
dashboard adds ownership *scoping* in the UI — the node owner sees every developer's hosted dApps, a
developer sees only the ones they published — but because the read APIs are open, this is a
convenience boundary, **not** a hard multi-tenant wall. A real per-developer boundary (each developer
authenticates with a signed identity / key, and the node enforces "you only see and manage your own"
server-side) is on the roadmap.

## Changing the rules

Until on-chain governance exists, protocol and parameter changes (the authority set, fees, block
timing, module set) are made by the maintainers via pull request in this repository, and take effect
when operators update and restart their nodes. Node operators always retain the final say: they choose
which software version and which authority set to run.

Planned direction: move parameter and authority-set changes on-chain (proposals + stake-weighted
votes) as part of the PoS/BFT work.

## Money & incentives

Fees and block rewards are configurable per node (`ACP_FEE_BPS`, `ACP_BLOCK_REWARD`) and default to
off. aETH is the network's native token — modeled on Ethereum's economics, **free-floating and not
pegged to any fiat** (see the README's **What is aETH?**). Today it's a closed-loop ledger credit with
no market value; on-chain issuance, at which point demand sets its price, is a deliberate legal/custody
decision.

---

*This document reflects the project's honest current state. As BFT/PoS, on-chain governance, and
real settlement land, it will be updated to match.*
