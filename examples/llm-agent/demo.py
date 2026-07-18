"""A *real* reasoning agent on ACP, powered by a local LLM (e.g. Qwen2.5 via Ollama).

`Sage` is an agent whose brain is your locally-running model — no cloud, no API key. `Curious`
discovers Sage, pays for a question over the x402 rail, and gets a genuinely model-generated answer
back over the A2A relay. This is "agents are built using a prompt", running on your own machine.

Prerequisites:
  - An ACP node running (Terminal 1):        pnpm --filter @acp/node dev
  - A local LLM serving an OpenAI-compatible API. With Ollama:
        ollama serve            (usually already running)
        ollama pull qwen2.5:7b  (once)
  - Config (optional) in .env:  LLM_BASE_URL=http://localhost:11434/v1  LLM_MODEL=qwen2.5:7b

Run:  python examples/llm-agent/demo.py
"""

from __future__ import annotations

import os
import threading
from typing import Any

from acp_sdk import LLM, Agent, LLMError, load_env

load_env()  # read LLM_BASE_URL / LLM_MODEL from .env if present

BASE_URL = os.environ.get("ACP_URL", "http://127.0.0.1:8787")
SUFFIX = os.environ.get("ACP_DEMO_SUFFIX", "")
QUESTION = (
    "In two sentences, what makes an 'agentic internet' different from today's web?"
)


def rule(title: str) -> None:
    print(f"\n\033[1m{'─' * 3} {title} {'─' * (58 - len(title))}\033[0m")


def main() -> None:
    brain = LLM(
        system=(
            "You are Sage, a concise expert agent on the ACP network. "
            "Answer clearly in at most two sentences."
        )
    )
    print(f"Sage's brain: model '{brain.model}' at {brain.base_url}")

    # --- Sage: a paid agent whose brain is the local LLM ---
    rule("agents join ACP")
    sage = Agent(
        f"sage{SUFFIX}",
        name="Sage",
        description="Answers questions using a local LLM.",
        base_url=BASE_URL,
        skills=[
            {
                "id": "ask",
                "name": "Ask",
                "description": "Answer a question",
                "tags": ["llm"],
            }
        ],
        pricing={"perTask": 300, "currency": "aETH"},  # 3.00 aETH/question
    )
    sage.register()
    print(f"  Sage    {sage.web3_id}  (charges 3.00 aETH/question)")

    def on_task(agent: Agent, message: dict[str, Any]) -> None:
        body = message["body"]
        question = body["input"]["question"]
        print(f"  Sage is thinking about: {question!r}")
        try:
            answer = brain.chat(question)
        except LLMError as exc:
            agent.reply_result(
                message["from"], body["taskId"], {"error": str(exc)}, state="failed"
            )
            return
        agent.reply_result(message["from"], body["taskId"], {"answer": answer})

    sage.on_task(on_task)
    sage.connect()

    # --- Curious: pays Sage and asks a question ---
    curious = Agent(f"curious{SUFFIX}", name="Curious", base_url=BASE_URL)
    curious.register()
    print(f"  Curious {curious.web3_id}")

    done = threading.Event()
    inbox: dict[str, Any] = {}

    def on_result(_agent: Agent, message: dict[str, Any]) -> None:
        inbox["result"] = message["body"]
        done.set()

    curious.on_result(on_result)
    curious.connect()

    rule("x402: pay for a question")
    quote = curious.x402_quote(sage.web3_id, "ask")
    price = quote["accepts"][0]["amount"]
    curious.pay(sage.web3_id, price, memo="ask")
    print(f"  Curious paid Sage {price / 100:.2f} aETH")

    rule("ask the local LLM, over ACP")
    print(f"  Q: {QUESTION}")
    curious.submit_task(sage.web3_id, "ask", {"question": QUESTION})
    if not done.wait(180):
        raise SystemExit("timed out waiting for Sage")

    result = inbox["result"].get("output", {})
    if "answer" in result:
        print(f"  A: {result['answer']}")
    else:
        print(f"  Sage failed: {result.get('error')}")

    rule("settlement")
    print(f"  Sage balance:    {sage.balance() / 100:.2f} aETH")
    print(f"  Curious balance: {curious.balance() / 100:.2f} aETH")

    curious.close()
    sage.close()
    print(
        "\n\033[1mDone.\033[0m A real LLM-powered agent, paid over ACP — all on your machine."
    )


if __name__ == "__main__":
    main()
