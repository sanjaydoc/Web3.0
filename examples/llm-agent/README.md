# LLM agent (local model)

A **real reasoning agent** on Web3.0 whose brain is a **locally-running LLM** — Qwen2.5, Llama, Mistral,
etc. via [Ollama](https://ollama.com) (or any OpenAI-compatible server like LM Studio / vLLM). No
cloud, no API key.

`Sage` answers questions with your local model; `Curious` discovers Sage, pays over the x402 rail,
and gets a genuinely model-generated answer back over the A2A relay.

## Prerequisites

1. A Web3.0 node running (Terminal 1): `pnpm --filter @web3/node dev`
2. A local model served over an OpenAI-compatible API. With Ollama:
   ```bash
   ollama serve            # usually already running
   ollama pull qwen2.5:7b  # once
   ```
3. Config in `.env` (already the defaults in `.env.example`):
   ```ini
   LLM_BASE_URL=http://localhost:11434/v1
   LLM_MODEL=qwen2.5:7b
   LLM_FALLBACK_MODELS=llama3.1,mistral,phi3
   ```

## Run

```bash
# Windows: .venv\Scripts\activate   (macOS/Linux: source .venv/bin/activate)
python examples/llm-agent/demo.py
```

You'll see Sage register, get paid, think with your local model, and answer — all settled on the
quantum-resistant ledger and visible in the dashboard.

## Fallback

`LLM_FALLBACK_MODELS` are tried in order if the primary model errors or isn't installed, so the
agent keeps working with **whatever model you have**. For example, with `LLM_MODEL=qwen2.5:7b` and
`LLM_FALLBACK_MODELS=llama3.1`, if Qwen isn't pulled the agent automatically uses Llama.

## Build your own

The brain is three lines:

```python
from web3_sdk import LLM
brain = LLM(system="You are a helpful agent.")
answer = brain.chat("your prompt")
```

Drop `brain.chat(...)` inside any agent's `on_task` handler and you have an autonomous, paid,
LLM-powered Web3.0 agent.
