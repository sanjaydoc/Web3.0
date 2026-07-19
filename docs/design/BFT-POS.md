# Design: BFT/PoS validators + state-machine replication

Status: **design** (roadmap item). This turns today's round-robin **proof-of-authority (PoA)** chain
into a **staked, byzantine-fault-tolerant** one. It is a multi-phase effort; this doc is the plan and
the interfaces, not a finished implementation.

## Where we are today (`@web3/consensus`)
- Round-robin PoA: authorities take turns proposing ML-DSA-signed blocks over the ledger.
- **Safety** by signature (`verifyChain()`); **liveness** by proposer-skip (`WEB3_SLOT_MS`).
- Fork choice = longest valid chain, most-in-turn history, deterministic.
- Trust = honesty of a small, curated authority set (see `GOVERNANCE.md`). A colluding majority of
  authorities could reorder/censor — the gap this item closes.

## Target
Replace "authority = whoever is on the list" with "**validator = whoever has bonded stake**", and
replace longest-chain with a **BFT commit rule** (a block is final once ⅔+ of stake attests to it),
plus **slashing** for equivocation/liveness faults.

## Phased plan
1. **Staking ledger.** A new ledger entry type `stake` (bond/unbond) tracked per validator address
   (reuse the accounts addresses from the `accounts` service). Voting power = bonded stake.
   Deliverable: `StakeSet` with `powerOf(addr)`, `total()`, bond/unbond with an unbonding delay.
2. **BFT voting round (Tendermint-style).** Per height: `propose → prevote → precommit → commit`.
   A block commits when precommits representing **> ⅔ total stake** are collected. Add message types
   `Prevote`/`Precommit` (ML-DSA-signed) gossiped like blocks today.
   Deliverable: `BftEngine` alongside the current `Engine`, selected by `WEB3_CONSENSUS=bft`.
3. **State-machine replication.** Make block application a pure reducer `apply(state, block) → state`
   over the ledger so every validator converges on identical state; snapshot + replay for fast sync.
4. **Slashing.** Detect double-sign (two conflicting precommits at one height) and downtime; burn a
   fraction of the offender's stake via a `slash` ledger entry. This is what makes trust
   *protocol-enforced* rather than *reputational*.
5. **Validator-set changes on-chain.** Bond/unbond and parameter changes become transactions, closing
   the "rule changes happen via PR" gap in `GOVERNANCE.md`.

## Interfaces (sketch)
```ts
interface Vote { height: number; round: number; blockHash: string; validator: string; sig: string }
interface BftEngine {
  onProposal(block: Block): void;
  onVote(vote: Vote): void;
  step(nowMs: number): { broadcast?: Vote | Block; committed?: Block };
}
interface StakeSet { powerOf(addr: string): bigint; total(): bigint; }
```

## Migration & compatibility
- Ship `bft` as an opt-in mode; keep `poa` as default until a staked validator set exists.
- Reuse the existing block format (add a `commit` field carrying the ⅔ precommit set).
- The threat-model text in `GOVERNANCE.md` updates from "colluding authority majority" to
  "attacker controlling > ⅓ stake can halt, > ⅔ can finalize" — the standard BFT bound.

## Testing strategy
- N-validator in-process harness (extend `demo-consensus.ts`): commit under ⅔+, **stall under < ⅔**,
  recover when power returns; a double-signer gets slashed; snapshots replay to identical state.

## Out of scope (later)
- P2P beyond the current WebSocket gossip (libp2p), light clients, cross-chain bridging.
