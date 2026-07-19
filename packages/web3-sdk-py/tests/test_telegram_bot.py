"""Unit tests for the Telegram bridge command router (no Telegram, no node needed)."""

from __future__ import annotations

import pathlib
import sys

# The bot lives under examples/, not in the package — add it to the path to import it.
_BOT_DIR = pathlib.Path(__file__).resolve().parents[3] / "examples" / "telegram-bot"
sys.path.insert(0, str(_BOT_DIR))

import bot  # noqa: E402


class StubAgent:
    web3_id = "tg@web3.0"

    def balance(self) -> int:
        return 500  # 5.00 aETH


class StubBridge:
    def __init__(self) -> None:
        self.agent = StubAgent()
        self.asked: tuple[str, str] | None = None

    def ask(self, agent_ref: str, question: str) -> str:
        self.asked = (agent_ref, question)
        return "the answer"


def test_help_and_start() -> None:
    b = StubBridge()
    assert "Web3.0 bridge" in bot.handle_command(b, "/help")
    assert "Web3.0 bridge" in bot.handle_command(b, "/start")
    assert "Web3.0 bridge" in bot.handle_command(b, "")  # empty → help


def test_whoami_shows_id_and_balance() -> None:
    reply = bot.handle_command(StubBridge(), "/whoami")
    assert "tg@web3.0" in reply
    assert "5.00 aETH" in reply


def test_ask_routes_agent_and_question() -> None:
    b = StubBridge()
    reply = bot.handle_command(b, "/ask sage what is acp?")
    assert reply == "the answer"
    assert b.asked == ("sage", "what is acp?")


def test_ask_requires_a_question() -> None:
    assert "usage" in bot.handle_command(StubBridge(), "/ask sage").lower()


def test_unknown_command() -> None:
    assert "unknown command" in bot.handle_command(StubBridge(), "/nope").lower()


def test_agents_lists_from_node(monkeypatch) -> None:
    monkeypatch.setattr(
        bot,
        "get_json",
        lambda _url: {
            "agents": [
                {"web3Id": "sage@web3.0", "name": "Sage", "skills": [{"id": "ask"}]},
            ]
        },
    )
    reply = bot.handle_command(StubBridge(), "/agents")
    assert "sage@web3.0" in reply and "ask" in reply
