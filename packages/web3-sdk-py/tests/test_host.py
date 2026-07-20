"""Unit tests for AgentHost — the no-VPS multi-agent supervisor (no network needed)."""

from __future__ import annotations

from web3_sdk import AgentHost


class FakeAgent:
    """Duck-types the bits of Agent that AgentHost touches."""

    def __init__(self, *, connected: bool = False, registered: bool = False) -> None:
        self._connected = connected
        self._registered = registered
        self.web3_id = "fake@web3.0"
        self.registers = 0
        self.connects = 0
        self.reconnects = 0
        self.closed = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    def register(self) -> None:
        self.registers += 1
        self._registered = True

    def connect(self) -> None:
        self.connects += 1
        self._connected = True

    def reconnect(self) -> None:
        self.reconnects += 1
        self._connected = True

    def close(self) -> None:
        self.closed = True
        self._connected = False


def test_start_registers_unregistered_and_connects_all() -> None:
    host = AgentHost()
    a = host.add(FakeAgent(registered=False))
    b = host.add(FakeAgent(registered=True))
    host.start()
    assert a.registers == 1  # a was not registered → registered now
    assert b.registers == 0  # b already registered → skipped
    assert a.connects == 1 and b.connects == 1


def test_supervise_revives_only_dropped_agents() -> None:
    host = AgentHost()
    up = host.add(FakeAgent(connected=True))
    down = host.add(FakeAgent(connected=False))
    revived = host.supervise_once()
    assert revived == [down.web3_id]
    assert down.reconnects == 1
    assert up.reconnects == 0  # a live agent is left alone


def test_close_closes_every_agent() -> None:
    host = AgentHost()
    agents = [host.add(FakeAgent(connected=True)) for _ in range(3)]
    host.close()
    assert all(a.closed for a in agents)
