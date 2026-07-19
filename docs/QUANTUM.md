# Quantum Security — the honest model

Web3.0 is marketed as **quantum-resistant**. This page is deliberate about what that does and does
not mean, because building on a false promise would be worse than not building at all.

## What we do *not* claim

- **"Unhackable."** No system is unhackable. Bugs, key mismanagement, social engineering, and
  implementation flaws all remain. We claim resistance to a *specific* future threat, nothing more.
- **A literal quantum-computing blockchain.** Chains running on quantum hardware or QKD links are
  research-stage; there is nothing production-grade to ship today. Web3.0 does not pretend otherwise.

## What we *do* claim

Web3.0 is secure against an adversary with a large-scale **quantum computer** running Shor's
algorithm, which would break the elliptic-curve and RSA signatures that most of Web3 relies on. It
does this by using **NIST-standardized post-quantum cryptography** everywhere identity or integrity
matters:

| Purpose | Algorithm | Standard |
| --- | --- | --- |
| Signatures (identity, messages, payments, ledger) | **ML-DSA-65** (Dilithium) | FIPS 204 |
| Confidential data sharing between agents | **ML-KEM-768** (Kyber) | FIPS 203 |
| Hash-based signatures (roadmap alternative) | SLH-DSA (SPHINCS+) | FIPS 205 |

Implementations: [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum) (TypeScript,
audited) and [`dilithium-py`](https://github.com/GiacomoPope/dilithium-py) /
[`kyber-py`](https://github.com/GiacomoPope/kyber-py) (Python). We never roll our own cryptography.

### Cross-language, tamper-evident

Because both runtimes implement the same FIPS standards over the same canonical byte encodings, a
signature made in one verifies in the other. `examples/two-agents-demo/verify_ledger.py`
independently re-verifies the TypeScript node's ML-DSA-signed ledger **from Python**, then forges an
entry to show verification fails at exactly that index. That cross-language check is the concrete,
demonstrable meaning of "quantum-resistant and tamper-evident".

## The ledger, honestly

The base ledger is a **verifiable, PQC-signed, append-only log**. On top of it, an **opt-in
proof-of-authority L1** (`WEB3_CONSENSUS=poa`) now lets multiple nodes agree on a shared, signed block
history — real multi-node consensus, but round-robin PoA over a fixed authority set, not yet a
byzantine-fault-tolerant validator set. Likewise, **settlement is pluggable** (internal / simulated /
testnet ERC-20), but real-money mainnet settlement deliberately requires a signer you add yourself.
So: the mechanics are real and demonstrable end-to-end, but this is **not** production financial
infrastructure yet — treat the items below as the remaining distance.

## Roadmap: the quantum research track

Clearly labelled as forward-looking, not shipped:

1. **Mainnet settlement** — add a funded signer to the testnet ERC-20 rail (out of the box by design)
   and bridge to multi-chain stablecoins via x402 / AP2.
2. **BFT/PoS validators + state-machine replication** — go beyond round-robin PoA and a replicated
   block log to a byzantine-fault-tolerant validator set that also replicates balances across nodes.
3. **Hash-based signatures** — offer SLH-DSA (FIPS 205) for parties who prefer conservative,
   hash-based security over lattice assumptions.
4. **Quantum hardware exploration** — QKD and quantum-RNG experiments, tracked as research, never
   marketed as production security.

If you take one thing from this page: **quantum-resistant is a real, defensible property; "unhackable"
is not.** Web3.0 only claims the former.
