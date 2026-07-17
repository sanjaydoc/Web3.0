"""A tiny LLM client so an agent's brain can be "built using a prompt".

Talks to any OpenAI-compatible chat endpoint — which includes **Ollama** (local Qwen, Llama, …),
LM Studio, vLLM, and the OpenAI/Anthropic-compatible gateways. Defaults to a local Ollama server,
so a locally-running `qwen2.5:7b` works out of the box with no API key and no cloud.

    from acp_sdk import LLM
    brain = LLM(system="You are a concise research assistant.")
    answer = brain.chat("Summarise Web 3.0 in one sentence.")

It tries a list of models in order and falls back to the next if one errors or isn't installed —
so you can run whatever local model you have. Configure via environment (or a .env):
LLM_BASE_URL, LLM_MODEL, LLM_FALLBACK_MODELS (comma-separated), LLM_API_KEY.
"""

from __future__ import annotations

import json
import os
import urllib.request

DEFAULT_BASE_URL = "http://localhost:11434/v1"  # Ollama's OpenAI-compatible endpoint
DEFAULT_MODEL = "qwen2.5:7b"


class LLMError(Exception):
    pass


def _resolve_models(model: str | None, models: list[str] | None) -> list[str]:
    """Build the ordered model list: explicit `models`, else LLM_MODEL + LLM_FALLBACK_MODELS."""
    if models:
        chosen = list(models)
    else:
        primary = model or os.environ.get("LLM_MODEL") or DEFAULT_MODEL
        fallbacks = [
            m.strip() for m in os.environ.get("LLM_FALLBACK_MODELS", "").split(",") if m.strip()
        ]
        chosen = [primary, *fallbacks]
    # De-duplicate while preserving order.
    seen: set[str] = set()
    ordered = [m for m in chosen if not (m in seen or seen.add(m))]
    return ordered or [DEFAULT_MODEL]


class LLM:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        model: str | None = None,
        models: list[str] | None = None,
        api_key: str | None = None,
        system: str | None = None,
        temperature: float = 0.4,
        timeout: float = 120.0,
    ) -> None:
        self.base_url = (base_url or os.environ.get("LLM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.models = _resolve_models(model, models)
        # Ollama ignores the key but the OpenAI wire format wants one; "ollama" is a fine dummy.
        self.api_key = api_key or os.environ.get("LLM_API_KEY") or "ollama"
        self.system = system
        self.temperature = temperature
        self.timeout = timeout
        # The model that last answered successfully (useful for logging/UX).
        self.used_model: str | None = None

    @property
    def model(self) -> str:
        """The primary (first) model — what's tried before any fallback."""
        return self.models[0]

    def chat(self, prompt: str) -> str:
        """Send a single-turn prompt, trying each configured model until one answers."""
        errors: list[str] = []
        for model in self.models:
            try:
                answer = self._chat_once(model, prompt)
                self.used_model = model
                return answer
            except LLMError as exc:
                errors.append(f"  - {model}: {exc}")
        raise LLMError(
            f"all models failed at {self.base_url}. Is your local LLM server running and are the "
            f"models installed (e.g. `ollama pull {self.models[0]}`)?\n" + "\n".join(errors)
        )

    def _chat_once(self, model: str, prompt: str) -> str:
        messages: list[dict[str, str]] = []
        if self.system:
            messages.append({"role": "system", "content": self.system})
        messages.append({"role": "user", "content": prompt})
        body = json.dumps(
            {
                "model": model,
                "messages": messages,
                "temperature": self.temperature,
                "stream": False,
            }
        ).encode("utf-8")

        req = urllib.request.Request(f"{self.base_url}/chat/completions", data=body, method="POST")
        req.add_header("content-type", "application/json")
        req.add_header("authorization", f"Bearer {self.api_key}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - surface any transport/HTTP error uniformly
            raise LLMError(str(exc)) from exc

        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"unexpected response shape: {data!r}") from exc
