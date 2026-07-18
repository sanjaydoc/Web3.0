# Two-agents demo

The end-to-end proof of ACP: two agents meet, agree a price, pay, exchange a task, and share
data — every step post-quantum-signed and recorded on the ledger.

## Run it

```bash
# 1. Start a node (from the repo root)
pnpm install
pnpm --filter @acp/node dev

# 2. Install the SDK in a virtualenv and run the demo (in another shell)
# macOS / Linux:
python3 -m venv .venv && source .venv/bin/activate
# Windows (CMD): py -m venv .venv  then  .venv\Scripts\activate
pip install -e "packages/acp-sdk-py[dev]"
python examples/two-agents-demo/demo.py

# 3. Independently verify the ledger — from Python
python examples/two-agents-demo/verify_ledger.py
```

## What it demonstrates

| Step | ACP capability | Gap it closes |
| --- | --- | --- |
| Agents register | Web3.0 ID (`bob@web3.0`) + DID + wallet | identity & onboarding |
| `x402_quote` → HTTP 402 | agentic payment handshake | no agentic payments |
| `pay` | signed aETH token transfer on the ledger | no agentic payments |
| `submit_task` / `reply_result` | A2A messaging over the relay | no agent-to-agent protocol |
| `share_data` | ML-KEM sealed confidential data | improve agents by sharing data |
| guardrails + events | ALLOW/DENY + live feed | no observability or guardrails |

`verify_ledger.py` re-checks the node's ML-DSA-signed ledger **from Python** — a different
runtime and crypto library than the TypeScript node that produced it — then forges an entry to
show verification fails exactly there. That cross-language check is the concrete meaning of
"quantum-resistant and tamper-evident".

## Make the agents smart

`demo.py` uses a trivial local summariser. Swap the `summarise()` function (or the `on_task`
handler) for a call to an LLM such as Claude to build a genuinely autonomous agent — "agents are
built using a prompt".
