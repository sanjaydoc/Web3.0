"""The Web3.0 agent SDK.

An :class:`Agent` owns a post-quantum identity (an email-like Web3.0 ID, a DID, and a wallet),
registers with a node, and then talks to other agents over the relay: submitting tasks, paying
for them, and sharing data — every payload signed with ML-DSA.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from typing import Any

from websocket import WebSocket, WebSocketTimeoutException, create_connection

from . import crypto
from .http import get_json, post_json

Handler = Callable[["Agent", dict[str, Any]], None]


class Agent:
    def __init__(
        self,
        local: str,
        *,
        name: str | None = None,
        description: str = "",
        base_url: str = "http://127.0.0.1:8787",
        kind: str = "agent",
        skills: list[dict[str, Any]] | None = None,
        pricing: dict[str, Any] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.local = local
        self.web3_id = f"{local}@web3.0"
        self.name = name or self.web3_id
        self.description = description
        self.kind = kind
        self.skills = skills or []
        self.pricing = pricing

        self._pk, self._sk = crypto.generate_keypair()
        self._kem_ek, self._kem_dk = crypto.generate_kem_keypair()
        self.sign_public_key = crypto.b64u(self._pk)
        self.kem_public_key = crypto.b64u(self._kem_ek)
        self.did = crypto.derive_did(self._pk)

        self._ws: WebSocket | None = None
        self._ws_lock = threading.Lock()
        self._reader: threading.Thread | None = None
        self._running = False
        self._registered = False
        self._handlers: dict[str, list[Handler]] = {}
        self.card: dict[str, Any] | None = None

    # --- identity / registration ----------------------------------------------------------

    def register(self) -> dict[str, Any]:
        """Join the network: claim the Web3.0 ID, publish the agent card, open a wallet.

        The request is wrapped in a signed envelope so the node can prove we hold the private key
        for the key we're registering — this binds the account and wallet to that key."""
        body = {
            "local": self.local,
            "name": self.name,
            "description": self.description,
            "kind": self.kind,
            "skills": self.skills,
            "pricing": self.pricing,
            "signPublicKey": self.sign_public_key,
            "kemPublicKey": self.kem_public_key,
        }
        result = post_json(f"{self.base_url}/agents", self.seal_envelope(body))
        self.card = result["card"]
        self._registered = True
        return result

    def resolve(self, web3_id: str) -> dict[str, Any]:
        return get_json(f"{self.base_url}/resolve/{web3_id}")

    def get_wallet(self, web3_id: str | None = None) -> dict[str, Any]:
        return get_json(f"{self.base_url}/wallets/{web3_id or self.web3_id}")["wallet"]

    def balance(self, web3_id: str | None = None) -> int:
        return self.get_wallet(web3_id)["balance"]

    # --- signing --------------------------------------------------------------------------

    def _now(self) -> str:
        # ISO-8601 UTC with milliseconds, matching the TypeScript `new Date().toISOString()`.
        import datetime

        return (
            datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
            + f"{datetime.datetime.now().microsecond // 1000:03d}Z"
        )

    def seal_envelope(self, payload: Any, now: str | None = None) -> dict[str, Any]:
        """Wrap a payload in a signed envelope byte-compatible with ``@web3/core`` ``seal``."""
        meta = {
            "signer": self.web3_id,
            "did": self.did,
            "ts": now or self._now(),
            "nonce": os.urandom(16).hex(),
        }
        signature = crypto.sign_string(
            self._sk, crypto.canonicalize({"payload": payload, "meta": meta})
        )
        return {
            "payload": payload,
            "meta": meta,
            "alg": crypto.SIGNATURE_ALG,
            "publicKey": self.sign_public_key,
            "signature": signature,
        }

    # --- payments -------------------------------------------------------------------------

    def x402_quote(self, to: str, skill_id: str) -> dict[str, Any]:
        """Fetch the x402 (HTTP 402) price quote for a skill before committing to pay."""
        from .http import HttpError

        try:
            get_json(f"{self.base_url}/x402/quote/{to}/{skill_id}")
            raise RuntimeError("expected a 402 Payment Required response")
        except HttpError as exc:
            if exc.status == 402:
                return exc.body
            raise

    def pay(
        self, to: str, amount: int, *, task_id: str | None = None, memo: str | None = None
    ) -> dict[str, Any]:
        """Settle a signed payment to another agent in the network's native aETH unit."""
        instruction = {"from": self.web3_id, "to": to, "amount": amount}
        if task_id:
            instruction["taskId"] = task_id
        if memo:
            instruction["memo"] = memo
        envelope = self.seal_envelope(instruction)
        return post_json(f"{self.base_url}/pay", envelope)

    # --- relay / messaging ----------------------------------------------------------------

    def on(self, body_type: str, handler: Handler) -> None:
        self._handlers.setdefault(body_type, []).append(handler)

    def on_task(self, handler: Handler) -> None:
        self.on("task.submit", handler)

    def on_result(self, handler: Handler) -> None:
        self.on("task.result", handler)

    def on_data(self, handler: Handler) -> None:
        self.on("data.share", handler)

    def connect(self, timeout: float = 5.0) -> None:
        """Open the relay connection and authenticate with a signed hello."""
        ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://") + "/relay"
        ws = create_connection(ws_url, timeout=timeout)
        ws.send(_dumps({"kind": "hello", "envelope": self.seal_envelope({"web3Id": self.web3_id})}))
        ready = _loads(ws.recv())
        if ready.get("kind") != "ready":
            ws.close()
            raise RuntimeError(f"relay handshake failed: {ready}")
        # The connect timeout guards the handshake only. Clear it so the read loop blocks waiting
        # for frames instead of raising every `timeout` seconds — otherwise an agent that stays
        # idle longer than the timeout (e.g. while a peer's LLM is thinking) would have its reader
        # thread die on a routine read-timeout and silently miss the eventual reply.
        ws.settimeout(None)
        self._ws = ws
        self._running = True
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    @property
    def is_connected(self) -> bool:
        """True while the relay connection is open and its reader thread is alive."""
        return (
            self._running
            and self._ws is not None
            and self._reader is not None
            and self._reader.is_alive()
        )

    def reconnect(self, timeout: float = 5.0) -> None:
        """Re-open the relay connection after a drop, reusing the existing identity and handlers.

        Registration is not repeated (the account already exists); only the WebSocket is re-opened.
        Safe to call when already connected — it's a no-op then."""
        if self.is_connected:
            return
        self._running = False
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass
            self._ws = None
        self.connect(timeout=timeout)

    def _read_loop(self) -> None:
        while self._running and self._ws is not None:
            try:
                frame = _loads(self._ws.recv())
            except WebSocketTimeoutException:
                # A read-timeout is not fatal — the socket is still open, just idle. Keep waiting.
                continue
            except Exception:
                break
            if not frame:
                continue
            if frame.get("kind") == "deliver":
                message = frame["message"]
                body_type = message.get("body", {}).get("type")
                for handler in self._handlers.get(body_type, []):
                    handler(self, message)
            for handler in self._handlers.get("__frame__", []):
                handler(self, frame)

    def _send_frame(self, frame: dict[str, Any]) -> None:
        if self._ws is None:
            raise RuntimeError("not connected — call connect() first")
        with self._ws_lock:
            self._ws.send(_dumps(frame))

    def send(self, to: str, body: dict[str, Any], message_id: str | None = None) -> None:
        now = self._now()
        message = {
            "id": message_id or f"msg_{os.urandom(6).hex()}",
            "from": self.web3_id,
            "to": to,
            "ts": now,
            "body": body,
        }
        self._send_frame({"kind": "send", "envelope": self.seal_envelope(message, now)})

    def submit_task(
        self,
        to: str,
        skill_id: str,
        task_input: Any,
        *,
        offer: int | None = None,
        task_id: str | None = None,
    ) -> str:
        tid = task_id or f"task_{os.urandom(5).hex()}"
        body = {"type": "task.submit", "taskId": tid, "skillId": skill_id, "input": task_input}
        if offer is not None:
            body["offer"] = offer
        self.send(to, body)
        return tid

    def reply_result(self, to: str, task_id: str, output: Any, *, state: str = "completed") -> None:
        self.send(to, {"type": "task.result", "taskId": task_id, "state": state, "output": output})

    def share_data(
        self, to: str, label: str, data: Any, *, recipient_kem_key: str | None = None
    ) -> None:
        """Share data with another agent. If a recipient KEM key is given, the payload is sealed
        with post-quantum encryption (ML-KEM); otherwise it is sent signed but in the clear."""
        import json as _json

        if recipient_kem_key:
            sealed = crypto.seal(
                crypto.unb64u(recipient_kem_key), _json.dumps(data).encode("utf-8")
            )
            self.send(to, {"type": "data.share", "label": label, "sealed": sealed})
        else:
            self.send(to, {"type": "data.share", "label": label, "sealed": data})

    def open_shared(self, sealed: dict[str, Any]) -> Any:
        """Decrypt a sealed data-share payload addressed to this agent."""
        import json as _json

        return _json.loads(crypto.open_box(self._kem_dk, sealed).decode("utf-8"))

    def close(self) -> None:
        self._running = False
        if self._ws is not None:
            try:
                self._ws.close()
            finally:
                self._ws = None


def _dumps(value: Any) -> str:
    import json

    return json.dumps(value)


def _loads(raw: Any) -> dict[str, Any]:
    import json

    if raw is None or raw == "":
        return {}
    return json.loads(raw)
