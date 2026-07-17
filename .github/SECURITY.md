# Security Policy

## Our security posture

ACP is designed to be **quantum-resistant**, not "unhackable" — no system is. We use
NIST-standardized post-quantum cryptography so that identities and ledger entries remain
secure against attacks from future quantum computers:

- **Signatures:** ML-DSA (FIPS 204, Dilithium family)
- **Key encapsulation:** ML-KEM (FIPS 203, Kyber family)
- **Hash-based signatures (roadmap):** SLH-DSA (FIPS 205, SPHINCS+)

The MVP ledger is a verifiable, PQC-signed, append-only log — it is **not** a distributed
L1 and should not be treated as production-grade financial infrastructure. See
[`docs/QUANTUM.md`](../docs/QUANTUM.md) for the honest security model and roadmap.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Instead, use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository. We aim to acknowledge reports within 72 hours.

When reporting, please include:

- The affected module and version / commit.
- A description of the vulnerability and its impact.
- Steps to reproduce, if possible.
