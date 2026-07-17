"""Isolate the LLM brain from the rest of ACP.

This calls the SAME LLM client an agent uses (the OpenAI-compatible /v1 endpoint) with NO agents,
node, relay, or payments involved. It tells us whether the problem is the LLM call itself or the
agent layer around it.

Run:  python examples/llm-agent/check_brain.py
"""

from __future__ import annotations

import time

from acp_sdk import LLM, load_env

load_env()

brain = LLM()
print(f"provider   : {brain.provider_name}")
print(f"base_url   : {brain.base_url}")
print(f"models     : {brain.models}")
print(f"timeout    : {brain.timeout}s")
print("\nCalling POST {base}/chat/completions (the exact request an agent makes)…".format(base=brain.base_url))

start = time.time()
try:
    answer = brain.chat("Say hello in exactly five words.")
    print(f"\n✅ OK in {time.time() - start:.1f}s")
    print(f"   model used: {brain.used_model}")
    print(f"   answer    : {answer}")
except Exception as exc:  # noqa: BLE001 - we want to see whatever went wrong
    print(f"\n❌ FAILED after {time.time() - start:.1f}s")
    print(f"   {type(exc).__name__}: {exc}")
