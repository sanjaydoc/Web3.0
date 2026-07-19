"""Adapters — import an existing agent or model onto Web3.0.

An adapter turns something you already have (an HTTP agent, an OpenAI-compatible chat endpoint, or a
plain Python function) into a Web3.0 agent: `serve()` registers it, connects it to the relay, and
routes each incoming task to the adapter's `reply()`. This is the on-ramp for existing agents.

    from web3_sdk.adapters import OpenAIChatAdapter, serve

    adapter = OpenAIChatAdapter(base_url="http://localhost:11434/v1", model="qwen2.5:7b")
    serve(adapter, "myagent", base_url="http://127.0.0.1:8787", price=100)  # runs until Ctrl+C
"""
from __future__ import annotations

import json
import time
import urllib.request
from collections.abc import Callable
from typing import Any


class Adapter:
    """Base class. Subclass and implement `reply(payload) -> {"answer": ...}` (or any dict)."""

    skill_id: str = "ask"
    skill_name: str = "Ask"
    skill_desc: str = "Imported via a Web3.0 adapter"

    def reply(self, payload: dict[str, Any]) -> dict[str, Any]:  # pragma: no cover - abstract
        raise NotImplementedError

    @staticmethod
    def _question(payload: dict[str, Any]) -> str:
        return str(payload.get("question") or payload.get("prompt") or payload.get("text") or "")


class CallableAdapter(Adapter):
    """Wrap any `str -> str` Python function as a Web3.0 agent."""

    def __init__(self, fn: Callable[[str], str], *, skill_id: str = "ask", skill_name: str = "Ask"):
        self.fn = fn
        self.skill_id = skill_id
        self.skill_name = skill_name

    def reply(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"answer": self.fn(self._question(payload))}


class HttpAdapter(Adapter):
    """Import an existing HTTP agent: POST the task input to its URL, return its JSON reply.

    The endpoint receives ``{"input": <payload>}`` and should return ``{"answer": "..."}`` (or any
    object, which is passed through as the task output)."""

    def __init__(
        self, url: str, *, skill_id: str = "ask", skill_name: str = "Ask", timeout: float = 60
    ):
        self.url = url
        self.skill_id = skill_id
        self.skill_name = skill_name
        self.timeout = timeout

    def reply(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps({"input": payload}).encode()
        req = urllib.request.Request(
            self.url, data=body, headers={"content-type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            data = json.load(r)
        if isinstance(data, dict):
            if isinstance(data.get("answer"), str):
                return {"answer": data["answer"]}
            if isinstance(data.get("output"), dict):
                return data["output"]
        return data if isinstance(data, dict) else {"answer": str(data)}


class OpenAIChatAdapter(Adapter):
    """Import any OpenAI-compatible chat endpoint — OpenAI, OpenRouter, Ollama, vLLM, LM Studio…

    Calls ``{base_url}/chat/completions`` with the standard schema, so a huge range of existing
    agents/models can be put on Web3.0 with one line."""

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        api_key: str | None = None,
        system: str | None = None,
        skill_id: str = "ask",
        skill_name: str = "Ask",
        timeout: float = 120,
    ):
        self.endpoint = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.system = system
        self.skill_id = skill_id
        self.skill_name = skill_name
        self.timeout = timeout

    def reply(self, payload: dict[str, Any]) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        if self.system:
            messages.append({"role": "system", "content": self.system})
        messages.append({"role": "user", "content": self._question(payload)})
        body = json.dumps({"model": self.model, "messages": messages}).encode()
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            data = json.load(r)
        answer = data["choices"][0]["message"]["content"]
        return {"answer": answer}


def serve(
    adapter: Adapter,
    local: str,
    *,
    base_url: str = "http://127.0.0.1:8787",
    price: int = 0,
    description: str = "",
    block: bool = True,
):
    """Register `adapter` as a Web3.0 agent named `local@web3.0` and route tasks to it.

    Returns the connected `Agent`. With `block=True` (default) it runs until interrupted."""
    from .agent import Agent

    agent = Agent(
        local,
        description=description or adapter.skill_desc,
        base_url=base_url,
        skills=[
            {
                "id": adapter.skill_id,
                "name": adapter.skill_name,
                "description": adapter.skill_desc,
                "tags": ["adapter"],
            }
        ],
        pricing={"perTask": price, "currency": "aETH"},
    )
    agent.register()

    def on_task(a: Agent, message: dict[str, Any]) -> None:
        body = message["body"]
        try:
            out = adapter.reply(body.get("input", {}) or {})
            a.reply_result(message["from"], body["taskId"], out)
        except Exception as exc:  # noqa: BLE001 - surface any adapter error back to the caller
            a.reply_result(message["from"], body["taskId"], {"error": str(exc)}, state="failed")

    agent.on_task(on_task)
    agent.connect()
    if block:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    return agent
