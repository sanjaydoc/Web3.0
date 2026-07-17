# Quantum Security — the honest model

ACP is marketed as **quantum-resistant**. This page is deliberate about what that does and does
not mean, because building on a false promise would be worse than not building at all.

## What we do *not* claim

- **"Unhackable."** No system is unhackable. Bugs, key mismanagement, social engineering, and
  implementation flaws all remain. We claim resistance to a *specific* future threat, nothing more.
- **A literal quantum-computing blockchain.** Chains running on quantum hardware or QKD links are
  research-stage; there is nothing production-grade to ship today. ACP does not pretend otherwise.

## What we *do* claim

ACP is secure against an adversary with a large-scale **quantum computer** running Shor's
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

The MVP ledger is a **verifiable, PQC-signed, append-only log** maintained by a single node — not a
distributed layer-1 blockchain. It proves the mechanics (identity, payments, provenance, integrity)
end-to-end and is fully serialisable, but it is **not** production financial infrastructure and
should not be treated as such. Decentralized consensus and settlement are roadmap items.

## Roadmap: the quantum research track

Clearly labelled as forward-looking, not shipped:

1. **On-chain settlement** — migrate the internal ledger to a real L1 with post-quantum signatures,
   and bridge to multi-chain testnet stablecoins via x402 / AP2.
2. **Distributed consensus** — replace the single-authority signer with a PQC-secured validator set.
3. **Hash-based signatures** — offer SLH-DSA (FIPS 205) for parties who prefer conservative,
   hash-based security over lattice assumptions.
4. **Quantum hardware exploration** — QKD and quantum-RNG experiments, tracked as research, never
   marketed as production security.

If you take one thing from this page: **quantum-resistant is a real, defensible property; "unhackable"
is not.** ACP only claims the former.
