"""Unit tests for the Agent relay read loop, without needing a running node."""

from __future__ import annotations

import json

from websocket import WebSocketTimeoutException

from web3_sdk import Agent


class _FakeWS:
    """A minimal stand-in for a WebSocket that yields a scripted sequence of recv() outcomes."""

    def __init__(self, script: list[object]) -> None:
        self._script = script
        self.closed = False

    def recv(self) -> str:
        if not self._script:
            raise ConnectionError("closed")  # ends the loop
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return json.dumps(item)

    def close(self) -> None:
        self.closed = True


def test_read_loop_survives_idle_timeout_and_delivers_later() -> None:
    """A routine read-timeout (an idle gap longer than the connect timeout) must NOT kill the
    reader — otherwise a reply that arrives after a slow peer finishes is silently dropped."""
    agent = Agent("client", base_url="http://127.0.0.1:8799")
    received: list[dict] = []
    agent.on_result(lambda _a, message: received.append(message))

    deliver = {
        "kind": "deliver",
        "message": {
            "from": "worker@web3.0",
            "body": {"type": "task.result", "taskId": "t1", "output": {"answer": "ok"}},
        },
    }
    # First recv times out (peer still "thinking"), then the real reply arrives, then it closes.
    agent._ws = _FakeWS([WebSocketTimeoutException(), deliver])  # type: ignore[assignment]
    agent._running = True
    agent._read_loop()  # runs until the scripted ConnectionError breaks it

    assert len(received) == 1
    assert received[0]["body"]["output"]["answer"] == "ok"


def test_read_loop_stops_on_connection_close() -> None:
    """A genuine connection error ends the loop (rather than spinning forever)."""
    agent = Agent("client", base_url="http://127.0.0.1:8799")
    agent._ws = _FakeWS([ConnectionError("gone")])  # type: ignore[assignment]
    agent._running = True
    agent._read_loop()  # returns promptly instead of hanging
