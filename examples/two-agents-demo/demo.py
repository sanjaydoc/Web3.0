"""ACP end-to-end demo: two agents meet on the agentic internet.

Alice (a researcher) needs a document summarised. Bob (a summariser) sells that skill. They
discover each other, agree a price via the x402 handshake, settle a post-quantum-signed
stablecoin payment, exchange the task over the A2A relay, and Bob shares a confidential
"domain tips" dataset (ML-KEM sealed) to improve Alice's future work — all recorded on the
quantum-resistant ledger and visible live in the dashboard.

Run an ACP node first:  pnpm --filter @acp/node dev
Then:                    python examples/two-agents-demo/demo.py
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from acp_sdk import Agent

BASE_URL = os.environ.get("ACP_URL", "http://127.0.0.1:8787")
SUFFIX = os.environ.get(
    "ACP_DEMO_SUFFIX", ""
)  # lets the demo re-run without handle clashes

DOCUMENT = (
    "The next generation of the internet, Web 3.0, shifts control from a handful of platforms "
    "back to users through decentralization, verifiable ownership, and AI-native services. "
    "In the agentic internet, autonomous agents hold their own identity and wallet, discover "
    "one another, communicate over an open protocol, and pay each other for work without a "
    "human in the loop or a dedicated server per agent."
)


def rule(title: str) -> None:
    print(f"\n\033[1m{'─' * 3} {title} {'─' * (60 - len(title))}\033[0m")


def summarise(text: str) -> str:
    """A trivially simple local 'brain'. Swap this for an LLM (e.g. Claude) in a real agent."""
    first = text.split(". ")[0].strip()
    return f"{first}. ({len(text.split())} words → 1 sentence)"


def main() -> None:
    # --- Bob: a summariser agent that sells a skill --------------------------------------
    rule("agents join ACP")
    bob = Agent(
        f"bob{SUFFIX}",
        name="Bob the Summariser",
        description="Summarises documents on demand.",
        base_url=BASE_URL,
        skills=[
            {
                "id": "summarise",
                "name": "Summarise",
                "description": "Summarise a document",
                "tags": ["nlp"],
            }
        ],
        pricing={"perTask": 500, "currency": "aUSD"},  # 5.00 aUSD
    )
    bob_reg = bob.register()
    print(f"  Bob   registered as {bob.web3_id}")
    print(f"        DID {bob.did}")
    print(f"        wallet opened with {bob_reg['wallet']['balance'] / 100:.2f} aUSD")

    alice = Agent(f"alice{SUFFIX}", name="Alice the Researcher", base_url=BASE_URL)
    alice_reg = alice.register()
    print(f"  Alice registered as {alice.web3_id}")
    print(f"        DID {alice.did}")
    print(f"        wallet opened with {alice_reg['wallet']['balance'] / 100:.2f} aUSD")

    # Bob does the work when a task arrives, then shares data to improve the requester.
    def on_task(agent: Agent, message: dict[str, Any]) -> None:
        body = message["body"]
        requester = message["from"]
        result = summarise(body["input"]["text"])
        agent.reply_result(requester, body["taskId"], {"summary": result})
        # Share a confidential "domain tips" dataset, sealed to Alice's post-quantum KEM key.
        card = agent.resolve(requester)
        agent.share_data(
            requester,
            "domain-tips",
            {"tip": "Prefer primary sources", "confidence": 0.92},
            recipient_kem_key=card["kemPublicKey"],
        )

    bob.on_task(on_task)
    bob.connect()

    # Alice waits for the result and the shared data.
    got_result = threading.Event()
    got_data = threading.Event()
    inbox: dict[str, Any] = {}

    def on_result(_agent: Agent, message: dict[str, Any]) -> None:
        inbox["result"] = message["body"]
        got_result.set()

    def on_data(agent: Agent, message: dict[str, Any]) -> None:
        inbox["data"] = agent.open_shared(message["body"]["sealed"])  # ML-KEM decrypt
        got_data.set()

    alice.on_result(on_result)
    alice.on_data(on_data)
    alice.connect()

    # --- discovery + x402 price quote ----------------------------------------------------
    rule("x402: agree a price")
    quote = alice.x402_quote(bob.web3_id, "summarise")
    offer = quote["accepts"][0]
    print("  Alice requested a quote for 'summarise' → HTTP 402 Payment Required")
    print(f"  Bob quotes {offer['amount'] / 100:.2f} {offer['currency']} per task")

    # --- effortless agentic payment ------------------------------------------------------
    rule("effortless payment")
    receipt = alice.pay(bob.web3_id, offer["amount"], memo="summarise task")["receipt"]
    print(
        f"  Alice paid Bob {offer['amount'] / 100:.2f} aUSD  (receipt {receipt['id']})"
    )
    print(f"        settled on ledger seq #{receipt['ledgerSeq']}")

    # --- A2A task exchange ---------------------------------------------------------------
    rule("agent-to-agent task")
    task_id = alice.submit_task(bob.web3_id, "summarise", {"text": DOCUMENT})
    print(f"  Alice → Bob  task.submit ({task_id})")
    if not got_result.wait(10):
        raise SystemExit("timed out waiting for Bob's result")
    print(f"  Bob → Alice  task.result: {inbox['result']['output']['summary']}")

    # --- confidential data sharing -------------------------------------------------------
    rule("share data to improve the agent (ML-KEM sealed)")
    if not got_data.wait(10):
        raise SystemExit("timed out waiting for shared data")
    print(f"  Bob shared a sealed dataset; Alice decrypted: {inbox['data']}")

    # --- settlement summary --------------------------------------------------------------
    rule("settlement")
    print(f"  Alice balance: {alice.balance() / 100:.2f} aUSD")
    print(f"  Bob   balance: {bob.balance() / 100:.2f} aUSD")

    time.sleep(0.3)
    alice.close()
    bob.close()
    print(
        "\n\033[1mDemo complete.\033[0m Open the dashboard to see every step on the live feed and ledger."
    )


if __name__ == "__main__":
    main()
