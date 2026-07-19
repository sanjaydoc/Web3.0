"""Isolate the LLM brain from the rest of Web3.0.

This calls the SAME LLM client an agent uses (the OpenAI-compatible /v1 endpoint) with NO agents,
node, relay, or payments involved. It reproduces the exact request the demo's Sage makes — same
system prompt, same question, same model/params — so its result is conclusive:

  * OK in a few seconds  → the LLM path is fine; any demo hang is the agent/relay layer.
  * hangs here too       → it's the LLM call itself (a proxy intercepting localhost, or a slow
                           model), not Web3.0. Try a smaller model, e.g. LLM_MODEL=qwen2.5:3b.

Run:  python examples/llm-agent/check_brain.py
      python examples/llm-agent/check_brain.py "your own question here"
"""

from __future__ import annotations

import sys
import time

from web3_sdk import LLM, load_env

load_env()

QUESTION = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "In two sentences, what makes an 'agentic internet' different from today's web?"
)

brain = LLM(
    system=(
        "You are Sage, a concise expert agent on the Web3.0 network. "
        "Answer clearly in at most two sentences."
    )
)
print(f"provider   : {brain.provider_name}")
print(f"base_url   : {brain.base_url}")
print(f"models     : {brain.models}")
print(f"timeout    : {brain.timeout}s")
print(f"question   : {QUESTION!r}")
print(
    "\nCalling POST {base}/chat/completions (the exact request Sage makes)…".format(
        base=brain.base_url
    )
)

start = time.time()
try:
    answer = brain.chat(QUESTION)
    print(f"\n✅ OK in {time.time() - start:.1f}s")
    print(f"   model used: {brain.used_model}")
    print(f"   answer    : {answer}")
except Exception as exc:  # noqa: BLE001 - we want to see whatever went wrong
    print(f"\n❌ FAILED after {time.time() - start:.1f}s")
    print(f"   {type(exc).__name__}: {exc}")
