# Holes & options — an honest audit

Status: **strategy doc, not a plan.** Purpose: name the real gaps before deciding a direction. The
tech (PQC identity, ledger, PoA consensus, personas, hosting marketplace, signed mandates) is solid.
The gaps are **product and economics**, not engineering. Nothing here is built until we pick a lane.

---

## Hole 1 — Two role systems that overlap

**What's there:** the code has 4 roles (`admin | operator | developer | agent-owner`) but signup only
offers 2 personas (`operator`, `agent-owner`). `admin` is bootstrapped; `developer` predates the
persona split and now overlaps with `agent-owner`.

**Why it's a hole:** two concepts of "who a user is" drift out of sync — gating bugs, confusing docs,
dead code paths.

**Options**
- **A. Fold `developer` → `agent-owner`** (recommended). One persona for "I bring/build agents"; keep
  `admin`/`operator`. Migrate any `developer` accounts. Small, clean.
- **B. Keep `developer` as a sub-type** of agent-owner (human vs dApp publisher). More surface, only if
  dApps become a distinct product.
- **C. Leave it.** Cheapest now, keeps the rot.

---

## Hole 2 — Operator earnings depend entirely on demand *(addressed, non-inflationary)*

**Update (final design): rewards are 100% fee-funded — zero minting.** Every payment and hosting fee
(**3%**, `feeBps`/`hostingCommissionBps`) is split **1/1/1** with no new aETH created (`splitFee`):
- **1% → platform treasury**,
- **1% → the node that did the work** (its own withdrawable reward wallet — this is the "block reward",
  now recycled from fees, not minted; fixes the authority-incentive hole),
- **1% → the contribution pool** — a real fee-fed wallet distributed across contributing nodes by score
  each epoch (transfers from the pool, not mints).

The old inflationary mint knobs (`blockReward`, `nodeRewardPool`) are **off by default**, kept only as an
optional temporary bootstrap subsidy. Cold-start is handled by **running the first nodes yourself**
(option A), not by printing tokens.

Original framing below.

**What was there:** four earn paths, but with the old default config only **hosting fees** were live
(`feeBps`/`blockReward`/`nodeRewardPool` all defaulted 0). So an operator earned **only if someone rents**.

**Why it's a hole:** no demand ⇒ no earnings ⇒ no operators ⇒ no network. Classic cold-start. The old
minted pool "solved" it by paying operators to merely exist — which is exactly the gameable,
value-less path we (correctly) demoted.

**Options**
- **A. Time-boxed bootstrap subsidy** (recommended, already wired): turn `nodeRewardPool` on at a small
  rate for launch only, with a sunset date, to seed operators until real rentals appear. Honest if
  labelled "launch incentive, ending <date>."
- **B. Demand-first launch:** don't recruit operators until there's at least one paying use case; run
  the first hosts yourself. Avoids paying for idle capacity.
- **C. Utility floor:** operators also earn from *serving tasks/relay* (real work), not just hosting —
  ties earnings to usefulness, not presence.

---

## Hole 3 — The agent-owner value proposition (the weak link)

**What's there:** an agent-owner **pays** per epoch to have an agent hosted. Intended upside: no-VPS
always-on hosting, an on-chain identity + wallet, and an agent-to-agent economy.

**Why it's a hole:**
- They pay a clear cost; the **return is unproven**. Their agent only comes out ahead if it **earns
  more than the hosting fee** — and *who pays their agent for work* isn't built.
- Hosting a ~256 MB agent process is cheap and easy; the real cost (LLM inference) is paid separately
  in real money via the API key. So "rent a node" competes with "run it on my laptop / a $5 VPS /
  Vercel" and doesn't clearly win yet.

**Options**
- **A. Build the demand side first** (recommended): a marketplace where agents get **paid to do work**
  (tasks, skills, data) — by other agents or by humans. Hosting only makes sense once an agent can
  *earn on the network*. This is the missing half of the loop.
- **B. Reposition hosting's value:** not "cheap compute" but **"always-on + discoverable identity +
  gets paid automatically."** Sell reach and uptime, not CPU.
- **C. Drop paid hosting for owners; make owners free** and monetize elsewhere (see Hole 4). Owners
  join for the identity/economy; operators are paid by the platform or by task-servers.

---

## Hole 4 — The economy is circular (the one under all the others)

**What's there:** money flows agent-owner → host → 3% platform, **all in aETH**, and aETH is **minted
by a faucet** with no external value.

**Why it's the core hole:** if aETH only circulates internally, then "earning aETH," "paying aETH," and
"3% of aETH" are all **~$0 real**. There's no value *entering* the system — only internal reshuffling.
Every other hole is downstream of this.

**Where real value could enter**
- **A. Real customers pay real money.** Agents serve paying external users (fiat/stablecoin); the
  platform takes a take-rate on **real** revenue. aETH becomes an internal accounting unit, not the
  value itself. *(Strongest, hardest — needs real use cases.)*
- **B. aETH ↔ real value.** A stablecoin/fiat on-ramp so aETH is convertible (the `settlement` module
  already gestures at testnet stablecoins). Then the 3% is real, but you inherit custody/compliance/
  market-making complexity.
- **C. Sell the platform, not the token.** SaaS: charge for the hosting fabric + dashboard + PQC
  identity + always-on. Payments can stay internal/simulated. *(Simplest to make real revenue.)*

---

## Business model — pick one lane

| Model | Revenue | Needs | Risk |
|---|---|---|---|
| **Take-rate on real agent revenue** | % of real money agents earn | real paying demand for agent work | hardest to reach; biggest upside |
| **Convertible aETH + 3% fee** | 3% of hosting, made real via on-ramp | stablecoin/fiat rails, custody, compliance | regulatory + market-making burden |
| **SaaS platform fee** | subscription for hosting/identity/console | a product people pay to run agents on | least "web3", fastest to real $ |

**These aren't exclusive** — but shipping needs *one* primary. My read: **SaaS platform fee** is the
fastest path to non-circular revenue and de-risks the token question; **take-rate on real agent
revenue** is the bigger prize if the demand side (Hole 3, Option A) proves out. The **convertible-aETH**
path is the most "web3" but carries the heaviest non-engineering cost.

---

## The single question to answer first

> **Who is the paying customer, and what do they pay real money for?**

Everything else — roles, subsidies, hosting UX, the 3% — is plumbing that only matters once that answer
exists. Recommended next move: **not more features**, but a one-page answer to that question, then work
backward to the model. Suggested sequencing if we proceed: **Hole 4 (pick a value source) → Hole 3
(build the demand side) → Hole 2 (bootstrap) → Hole 1 (roles cleanup).**
