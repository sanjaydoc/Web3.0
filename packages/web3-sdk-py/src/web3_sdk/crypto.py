"""Post-quantum cryptographic primitives for Web3.0, byte-compatible with the TypeScript
``@web3/crypto`` package.

Signatures use ML-DSA-65 (FIPS 204) via ``dilithium-py``; confidential data sharing uses
ML-KEM-768 (FIPS 203) via ``kyber-py``. A signature produced here verifies in the TypeScript
node, and vice versa — the two runtimes speak the same standard.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from dilithium_py.ml_dsa import ML_DSA_65
from kyber_py.ml_kem import ML_KEM_768

SIGNATURE_ALG = "ML-DSA-65"
KEM_ALG = "ML-KEM-768"

_B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


# --- encoding -----------------------------------------------------------------------------


def b64u(data: bytes) -> str:
    """Base64url without padding — the transport encoding used across Web3.0."""
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonicalize(value: Any) -> str:
    """Deterministic JSON with sorted keys and no whitespace.

    Must match the TypeScript ``canonicalize`` exactly so signatures verify cross-language:
    sorted keys at every level, compact separators, and unicode preserved (no ``\\uXXXX``).
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hash_json(value: Any) -> str:
    return sha256_hex(canonicalize(value).encode("utf-8"))


def base58_encode(data: bytes) -> str:
    """Bitcoin/base58btc encoding, matching ``@scure/base`` ``base58.encode``."""
    num = int.from_bytes(data, "big")
    out = ""
    while num > 0:
        num, rem = divmod(num, 58)
        out = _B58_ALPHABET[rem] + out
    # Preserve leading zero bytes as '1'.
    for byte in data:
        if byte == 0:
            out = "1" + out
        else:
            break
    return out or "1"


# --- ML-DSA signatures --------------------------------------------------------------------


def generate_keypair() -> tuple[bytes, bytes]:
    """Return a fresh ``(public_key, secret_key)`` ML-DSA-65 keypair."""
    return ML_DSA_65.keygen()


def sign(secret_key: bytes, message: bytes) -> bytes:
    return ML_DSA_65.sign(secret_key, message)


def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    try:
        return ML_DSA_65.verify(public_key, message, signature)
    except Exception:
        return False


def sign_string(secret_key: bytes, message: str) -> str:
    return b64u(sign(secret_key, message.encode("utf-8")))


def verify_string(public_key: bytes, message: str, signature_b64u: str) -> bool:
    return verify(public_key, message.encode("utf-8"), unb64u(signature_b64u))


def derive_did(public_key: bytes) -> str:
    """``did:web3:z<base58(sha256(pubkey))>`` — identical to the TypeScript derivation."""
    return "did:web3:z" + base58_encode(hashlib.sha256(public_key).digest())


# --- ML-KEM sealed box (Python <-> Python confidential data sharing) -----------------------


def generate_kem_keypair() -> tuple[bytes, bytes]:
    """Return a fresh ``(encapsulation_key, decapsulation_key)`` ML-KEM-768 keypair."""
    return ML_KEM_768.keygen()


def _stream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hashlib.sha256(key + nonce + counter.to_bytes(8, "big")).digest())
        counter += 1
    return bytes(out[:length])


def seal(recipient_ek: bytes, plaintext: bytes) -> dict[str, str]:
    """Encrypt ``plaintext`` for a recipient's ML-KEM key using a hybrid PQC sealed box
    (ML-KEM shared secret + SHA-256 keystream, encrypt-then-HMAC)."""
    shared, ct = ML_KEM_768.encaps(recipient_ek)
    enc_key = hashlib.sha256(b"acp-enc" + shared).digest()
    mac_key = hashlib.sha256(b"acp-mac" + shared).digest()
    nonce = os.urandom(24)
    stream = _stream(enc_key, nonce, len(plaintext))
    body = bytes(a ^ b for a, b in zip(plaintext, stream, strict=True))
    mac = hmac.new(mac_key, nonce + body, hashlib.sha256).digest()
    return {
        "alg": KEM_ALG,
        "kem": b64u(ct),
        "nonce": b64u(nonce),
        "ct": b64u(body),
        "mac": b64u(mac),
    }


def open_box(recipient_dk: bytes, box: dict[str, str]) -> bytes:
    """Decrypt a sealed box with the recipient's ML-KEM decapsulation key."""
    shared = ML_KEM_768.decaps(recipient_dk, unb64u(box["kem"]))
    enc_key = hashlib.sha256(b"acp-enc" + shared).digest()
    mac_key = hashlib.sha256(b"acp-mac" + shared).digest()
    nonce, body, mac = unb64u(box["nonce"]), unb64u(box["ct"]), unb64u(box["mac"])
    if not hmac.compare_digest(hmac.new(mac_key, nonce + body, hashlib.sha256).digest(), mac):
        raise ValueError("sealed box authentication failed")
    stream = _stream(enc_key, nonce, len(body))
    return bytes(a ^ b for a, b in zip(body, stream, strict=True))
