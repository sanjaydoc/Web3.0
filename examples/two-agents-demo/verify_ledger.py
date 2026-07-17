"""Independently verify the node's quantum-resistant ledger — from Python.

Fetches the node's public key and its ledger, then re-checks every entry's hash link and its
ML-DSA signature *in Python* (a different runtime and PQC library than the TypeScript node that
produced them). Finally it tampers with one entry to show verification fails exactly there.

This is the integrity guarantee behind "quantum-resistant": the whole history is verifiable, and
any alteration is detectable — across languages.

    python examples/two-agents-demo/verify_ledger.py
"""

from __future__ import annotations

import os

from acp_sdk import crypto
from acp_sdk.http import get_json

BASE_URL = os.environ.get("ACP_URL", "http://127.0.0.1:8787")
GENESIS = "0" * 64


def verify_entries(node_pk: bytes, entries: list[dict]) -> tuple[bool, int, str]:
    prev = GENESIS
    for i, entry in enumerate(entries):
        if entry["prevHash"] != prev:
            return False, i, "broken hash link"
        core = {
            "seq": entry["seq"],
            "ts": entry["ts"],
            "prevHash": entry["prevHash"],
            "type": entry["type"],
            "data": entry["data"],
        }
        if crypto.hash_json(core) != entry["hash"]:
            return False, i, "entry hash mismatch (tampered content)"
        if not crypto.verify_string(node_pk, entry["hash"], entry["signature"]):
            return False, i, "invalid node signature"
        prev = entry["hash"]
    return True, -1, "ok"


def main() -> None:
    info = get_json(f"{BASE_URL}/")
    node_pk = crypto.unb64u(info["nodePublicKey"])
    # Fetch the full ledger oldest-first for chain verification.
    ledger = get_json(f"{BASE_URL}/ledger?limit=10000")
    entries = list(reversed(ledger["entries"]))  # endpoint returns newest-first

    print(
        f"Verifying {len(entries)} ledger entries against node key {info['nodePublicKey'][:16]}…"
    )
    ok, broken, reason = verify_entries(node_pk, entries)
    print(f"  cross-language verify: {'PASS' if ok else 'FAIL'} ({reason})")
    if not ok:
        raise SystemExit(f"unexpected: intact ledger failed at #{broken}")

    if not entries:
        print("  (ledger is empty — run demo.py first to populate it)")
        return

    # Now tamper: forge an amount in the first payment entry and re-verify.
    tampered = [dict(e) for e in entries]
    idx = next((i for i, e in enumerate(tampered) if e["type"] == "payment"), 0)
    tampered[idx] = dict(
        tampered[idx], data=dict(tampered[idx]["data"], amount=999_999)
    )
    ok2, broken2, reason2 = verify_entries(node_pk, tampered)
    print(
        f"  after forging entry #{idx}: {'PASS (BAD!)' if ok2 else 'FAIL as expected'} — {reason2} at #{broken2}"
    )
    if ok2:
        raise SystemExit("tampering was not detected — this should never happen")

    print(
        "\nThe ledger is tamper-evident across languages: Python verified TypeScript's PQC signatures."
    )


if __name__ == "__main__":
    main()
