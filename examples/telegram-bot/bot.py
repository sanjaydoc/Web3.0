"""A Telegram front door to the ACP agentic internet — humans talk to agents 24/7.

The bot is itself an ACP agent (with a Web3.0 ID + wallet). A human messages it on Telegram; the bot
discovers agents, pays them over x402, submits the task, and relays the answer back. This is the
"human ↔ agent" bridge from the roadmap.

Dependency-light: it long-polls Telegram with the standard library (no external packages), like the
rest of the SDK. Set TELEGRAM_BOT_TOKEN in .env (get one from @BotFather). With NO token it runs in
a local MOCK mode — type commands at the prompt and see the same responses — so you can try the
whole flow with zero setup.

Run:  python examples/telegram-bot/bot.py
Commands:  /help  /agents  /whoami  /ask <agent> <question>
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
import urllib.request
from typing import Any

from acp_sdk import Agent, load_env
from acp_sdk.http import HttpError, get_json

load_env()

NODE_URL = os.environ.get("ACP_URL", "http://127.0.0.1:8787")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
BOT_LOCAL = os.environ.get("ACP_TELEGRAM_LOCAL", "telegrambot")
ASK_SKILL = os.environ.get("ACP_TELEGRAM_SKILL", "ask")

HELP = (
    "🤖 *ACP bridge*\n"
    "/agents — list agents on the network\n"
    "/whoami — my Web3.0 ID and wallet balance\n"
    "/ask <agent> <question> — pay an agent and get an answer\n"
    "   e.g. `/ask sage what is the agentic internet?`"
)


class Bridge:
    """Wraps the bot's ACP agent and correlates task results back to /ask requests."""

    def __init__(self, agent: Agent) -> None:
        self.agent = agent
        self._results: dict[str, dict[str, Any]] = {}
        self._events: dict[str, threading.Event] = {}
        agent.on_result(self._on_result)

    def _on_result(self, _agent: Agent, message: dict[str, Any]) -> None:
        body = message["body"]
        tid = body.get("taskId")
        if tid:
            self._results[tid] = body
            self._events.setdefault(tid, threading.Event()).set()

    def ask(self, agent_ref: str, question: str, *, timeout: float = 60.0) -> str:
        to = agent_ref if agent_ref.endswith("@web3.0") else f"{agent_ref}@web3.0"
        try:
            quote = self.agent.x402_quote(to, ASK_SKILL)
        except HttpError as exc:
            return f"⚠️ couldn't get a quote from {to}: {exc.body.get('error', exc)}"
        price = quote["accepts"][0]["amount"]
        if price:
            self.agent.pay(to, price, memo=ASK_SKILL)
        tid = self.agent.submit_task(to, ASK_SKILL, {"question": question})
        event = self._events.setdefault(tid, threading.Event())
        if not event.wait(timeout):
            return "⏳ no answer in time — the agent may be offline."
        out = self._results[tid].get("output", {})
        return out.get("answer") or f"⚠️ {to} failed: {out.get('error', 'unknown error')}"


def handle_command(bridge: Bridge, text: str) -> str:
    """Pure command router — maps a message to a reply. Testable without Telegram."""
    text = text.strip()
    if not text:
        return HELP
    parts = text.split(maxsplit=2)
    cmd = parts[0].lower()

    if cmd in ("/start", "/help"):
        return HELP
    if cmd == "/whoami":
        try:
            bal = bridge.agent.balance() / 100
        except HttpError:
            bal = 0.0
        return f"I am `{bridge.agent.web3_id}`\nwallet: {bal:.2f} aETH"
    if cmd == "/agents":
        try:
            data = get_json(f"{NODE_URL}/agents")
        except HttpError as exc:
            return f"⚠️ couldn't reach the node: {exc}"
        agents = data.get("agents", [])
        if not agents:
            return "no agents registered yet."
        lines = [
            f"• `{a['web3Id']}` — {a.get('name', '')}"
            + (f" [{', '.join(s['id'] for s in a.get('skills', []))}]" if a.get("skills") else "")
            for a in agents
        ]
        return "*Agents on ACP:*\n" + "\n".join(lines)
    if cmd == "/ask":
        if len(parts) < 3:
            return "usage: /ask <agent> <question>"
        return bridge.ask(parts[1], parts[2])
    return f"unknown command {cmd!r}\n\n{HELP}"


# ── Telegram transport (stdlib only) ─────────────────────────────────────────────────────────────


class TelegramClient:
    def __init__(self, token: str) -> None:
        self.base = f"https://api.telegram.org/bot{token}"

    def _call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base}/{method}?{urllib.parse.urlencode(params)}"
        with urllib.request.urlopen(url, timeout=65) as resp:  # noqa: S310 - trusted Telegram host
            return json.loads(resp.read().decode("utf-8"))

    def get_updates(self, offset: int) -> list[dict[str, Any]]:
        data = self._call("getUpdates", {"timeout": 50, "offset": offset})
        return data.get("result", [])

    def send(self, chat_id: int, text: str) -> None:
        self._call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})


def run_telegram(bridge: Bridge, token: str) -> None:
    client = TelegramClient(token)
    print(f"Telegram bridge online as {bridge.agent.web3_id}. Talk to your bot on Telegram.")
    offset = 0
    while True:
        try:
            for update in client.get_updates(offset):
                offset = update["update_id"] + 1
                message = update.get("message") or {}
                text = message.get("text")
                chat = message.get("chat", {}).get("id")
                if text and chat is not None:
                    client.send(chat, handle_command(bridge, text))
        except Exception as exc:  # noqa: BLE001 - keep the bot alive across transient errors
            print(f"  (telegram error, retrying: {exc})")
            time.sleep(3)


def run_mock(bridge: Bridge) -> None:
    print(f"No TELEGRAM_BOT_TOKEN set — running in MOCK mode as {bridge.agent.web3_id}.")
    print("Type a command (or 'quit'). Try: /help\n")
    while True:
        try:
            text = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if text in ("quit", "exit"):
            break
        print(f"bot> {handle_command(bridge, text)}\n")


def main() -> None:
    bot = Agent(BOT_LOCAL, name="Telegram Bridge", base_url=NODE_URL)
    try:
        bot.register()
    except HttpError as exc:
        if exc.status != 409:  # already registered is fine
            raise
    bot.connect()
    bridge = Bridge(bot)
    try:
        if BOT_TOKEN:
            run_telegram(bridge, BOT_TOKEN)
        else:
            run_mock(bridge)
    finally:
        bot.close()


if __name__ == "__main__":
    main()
