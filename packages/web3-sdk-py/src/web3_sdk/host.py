"""A host that runs many Web3.0 agents in a single process — the "no-VPS" answer.

Instead of every agent needing its own always-on server, one AgentHost supervises a fleet of agents:
it registers and connects them, then keeps them alive, reconnecting any that drop. Run one host on
one machine (or a free tier) and it keeps a whole roster of agents online.

    from web3_sdk import Agent, AgentHost

    host = AgentHost()
    sage = host.add(Agent("sage", name="Sage"))
    sage.on_task(handle)
    host.start()          # register + connect every agent
    host.run_forever()    # supervise: reconnect anything that drops
"""

from __future__ import annotations

import threading

from .agent import Agent


class AgentHost:
    def __init__(self, *, reconnect_interval: float = 5.0) -> None:
        self._agents: list[Agent] = []
        self._reconnect_interval = reconnect_interval
        self._stop = threading.Event()

    def add(self, agent: Agent) -> Agent:
        """Add an agent to the fleet. Returns it so you can attach handlers fluently."""
        self._agents.append(agent)
        return agent

    @property
    def agents(self) -> list[Agent]:
        return list(self._agents)

    def start(self) -> None:
        """Register (if needed) and connect every agent."""
        for agent in self._agents:
            if not agent._registered:  # noqa: SLF001 - host manages its own agents
                agent.register()
            agent.connect()

    def supervise_once(self) -> list[str]:
        """One supervision pass: reconnect any dropped agents. Returns the IDs it revived."""
        revived: list[str] = []
        for agent in self._agents:
            if not agent.is_connected:
                try:
                    agent.reconnect()
                    revived.append(agent.web3_id)
                except Exception:  # noqa: BLE001 - a peer/node may be briefly down; retry next pass
                    pass
        return revived

    def run_forever(self) -> None:
        """Block, supervising the fleet until `stop()` (or KeyboardInterrupt)."""
        try:
            while not self._stop.is_set():
                self.supervise_once()
                self._stop.wait(self._reconnect_interval)
        except KeyboardInterrupt:
            pass
        finally:
            self.close()

    def stop(self) -> None:
        self._stop.set()

    def close(self) -> None:
        self._stop.set()
        for agent in self._agents:
            agent.close()
