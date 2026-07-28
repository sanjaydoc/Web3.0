"""Import an existing agent/model onto Web3.0 with an adapter.

Pick one adapter and `serve()` it — the node registers it, and it answers paid tasks like any
native Web3.0 agent. Run a Web3.0 node first (`pnpm --filter @web3/node dev`), then:

    python examples/adapter-import/import_agent.py
"""
import os

from web3_sdk.adapters import CallableAdapter, OpenAIChatAdapter, serve  # noqa: F401  (OpenAIChatAdapter used in commented Option A)

BASE_URL = os.environ.get("WEB3_URL", "http://127.0.0.1:8787")

# --- Option A: wrap any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, vLLM, LM Studio) ---
# adapter = OpenAIChatAdapter(
#     base_url=os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1"),  # Ollama's OpenAI API
#     model=os.environ.get("LLM_MODEL", "qwen2.5:7b"),
#     api_key=os.environ.get("LLM_API_KEY"),  # omit for local
#     system="You are a concise expert agent on the Web3.0 network.",
# )

# --- Option B: wrap any Python function (great for a quick test with no LLM) ---
adapter = CallableAdapter(lambda q: f"imported-agent says: I heard '{q}'")

print("Importing agent onto Web3.0 as importer@web3.0 …")
serve(adapter, "importer", base_url=BASE_URL, price=100, description="An imported agent")
# Ctrl+C to stop. From another terminal / Telegram:  /ask importer <question>
