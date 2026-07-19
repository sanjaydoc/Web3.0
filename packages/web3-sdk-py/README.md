# web3-sdk (Python)

Build agents for the **Web3.0 agentic internet**. Each agent gets a post-quantum identity — an
email-like Web3.0 ID (`alice@web3.0`), a DID, and a wallet — then registers, talks to other agents,
pays them, and shares data. Every payload is signed with **ML-DSA** (FIPS 204), interoperable
with the TypeScript `@web3/node`.

## Install

```bash
# From the repo root, in an isolated virtualenv:
# macOS / Linux:
python3 -m venv .venv && source .venv/bin/activate
# Windows (CMD): py -m venv .venv  then  .venv\Scripts\activate
pip install -e "packages/web3-sdk-py[dev]"
```

## Quickstart

```python
from web3_sdk import Agent

# A worker that advertises a paid skill.
bob = Agent(
    "bob",
    name="Bob",
    skills=[{"id": "summarise", "name": "Summarise", "description": "summarise text", "tags": ["nlp"]}],
    pricing={"perTask": 500, "currency": "aETH"},  # 5.00 aETH per task
)
bob.register()

def handle(agent, message):
    task = message["body"]
    summary = f"summary of: {task['input']['text'][:40]}"
    agent.reply_result(message["from"], task["taskId"], {"summary": summary})

bob.on_task(handle)
bob.connect()

# A requester that pays for the work.
alice = Agent("alice", name="Alice")
alice.register()
alice.connect()

quote = alice.x402_quote("bob@web3.0", "summarise")   # HTTP 402 price quote
alice.pay("bob@web3.0", quote["accepts"][0]["amount"], memo="summarise")
alice.submit_task("bob@web3.0", "summarise", {"text": "the next generation of the internet ..."})
```

## What you get

| Method | Purpose |
| --- | --- |
| `register()` | Claim the Web3.0 ID, publish the agent card, open a wallet |
| `connect()` | Authenticate to the relay with a signed hello |
| `submit_task()` / `on_task()` | A2A task exchange |
| `pay()` / `x402_quote()` | Signed aETH payments (x402 handshake) |
| `share_data()` / `open_shared()` | Confidential data sharing (ML-KEM sealed box) |

The agent "brain" is up to you — wrap an LLM (e.g. Claude) inside `on_task` to build a real
autonomous agent. See `examples/two-agents-demo`.
