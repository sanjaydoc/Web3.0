"""Unit tests for the SDK crypto layer, including cross-language canonicalisation parity."""

from web3_sdk import crypto


def test_canonicalize_matches_typescript() -> None:
    # Mirrors the TypeScript test: sorted keys, compact separators.
    assert crypto.canonicalize({"b": 1, "a": {"d": 2, "c": 3}}) == '{"a":{"c":3,"d":2},"b":1}'
    assert crypto.hash_json({"a": 1, "b": 2}) == crypto.hash_json({"b": 2, "a": 1})


def test_sign_and_verify() -> None:
    pk, sk = crypto.generate_keypair()
    sig = crypto.sign_string(sk, "task:123")
    assert crypto.verify_string(pk, "task:123", sig) is True
    assert crypto.verify_string(pk, "task:124", sig) is False


def test_verify_does_not_raise_on_garbage() -> None:
    pk, _ = crypto.generate_keypair()
    assert crypto.verify_string(pk, "x", "not-a-signature") is False


def test_derive_did_is_stable_and_formatted() -> None:
    pk, _ = crypto.generate_keypair()
    did = crypto.derive_did(pk)
    assert did == crypto.derive_did(pk)
    assert did.startswith("did:web3:z")


def test_base58_encode_known_vectors() -> None:
    # Matches Bitcoin/base58btc (as used by @scure/base).
    assert crypto.base58_encode(b"hello world") == "StV1DL6CwTryKyV"
    assert crypto.base58_encode(b"\x00\x00abc").startswith("11")


def test_sealed_box_roundtrip() -> None:
    ek, dk = crypto.generate_kem_keypair()
    secret = b'{"dataset":"run-42","rows":1000}'
    box = crypto.seal(ek, secret)
    assert crypto.open_box(dk, box) == secret


def test_sealed_box_rejects_wrong_key() -> None:
    ek, _ = crypto.generate_kem_keypair()
    _, dk_other = crypto.generate_kem_keypair()
    box = crypto.seal(ek, b"confidential")
    try:
        crypto.open_box(dk_other, box)
        raise AssertionError("expected authentication failure")
    except ValueError:
        pass


def test_sealed_box_detects_tampering() -> None:
    ek, dk = crypto.generate_kem_keypair()
    box = crypto.seal(ek, b"pay 10")
    box["ct"] = crypto.b64u(b"\x00" * len(crypto.unb64u(box["ct"])))
    try:
        crypto.open_box(dk, box)
        raise AssertionError("expected authentication failure")
    except ValueError:
        pass
