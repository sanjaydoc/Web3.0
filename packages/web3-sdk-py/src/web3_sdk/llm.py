"""A tiny multi-provider LLM client so an agent's brain can be "built using a prompt".

Bring your own key (BYOK): you pick a provider and supply your own key. The key lives with your
agent — it is **never** sent to the Web3.0 node or the network. Supported providers:

    local / ollama   → your machine (Ollama), no key, free   e.g. qwen2.5:7b
    openai           → https://api.openai.com/v1             e.g. gpt-4o-mini
    openrouter       → one key → many providers              e.g. anthropic/claude-3.5-sonnet
    groq / together  → other OpenAI-compatible gateways
    anthropic        → native Anthropic API                  e.g. claude-sonnet-5

Usage:
    from web3_sdk import LLM
    brain = LLM.provider("openrouter", model="anthropic/claude-3.5-sonnet", api_key="sk-or-...")
    answer = brain.chat("Summarise Web 3.0 in one sentence.")

Or configure via env / .env: LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_BASE_URL,
LLM_FALLBACK_MODELS (comma-separated).
"""

from __future__ import annotations

import json
import os
import urllib.request
from urllib.parse import urlparse

DEFAULT_MODEL = "qwen2.5:7b"

# Hosts that must never be reached through an HTTP proxy.
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _opener_for(url: str) -> urllib.request.OpenerDirector:
    """Build a urllib opener, bypassing any configured proxy for loopback URLs.

    On Windows a system/corporate proxy (HTTP_PROXY/HTTPS_PROXY) otherwise intercepts even
    127.0.0.1 requests and the call hangs — while `curl` bypasses the proxy for localhost
    automatically. This is the usual reason a local Ollama call "hangs" when `curl` to the same URL
    returns instantly. Hosted providers still honour the proxy env vars (needed behind a firewall).
    """
    host = (urlparse(url).hostname or "").lower()
    if host in _LOOPBACK_HOSTS:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener()

# Each provider: the API base URL and which wire format it speaks. Local servers use the explicit
# IPv4 loopback 127.0.0.1 rather than "localhost" — see `_prefer_ipv4` below for why.
PROVIDERS: dict[str, dict[str, str]] = {
    "local": {"base_url": "http://127.0.0.1:11434/v1", "kind": "openai"},
    "ollama": {"base_url": "http://127.0.0.1:11434/v1", "kind": "openai"},
    "openai": {"base_url": "https://api.openai.com/v1", "kind": "openai"},
    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "kind": "openai"},
    "groq": {"base_url": "https://api.groq.com/openai/v1", "kind": "openai"},
    "together": {"base_url": "https://api.together.xyz/v1", "kind": "openai"},
    "anthropic": {"base_url": "https://api.anthropic.com", "kind": "anthropic"},
}


def _prefer_ipv4(base_url: str) -> str:
    """Rewrite a `localhost` loopback host to `127.0.0.1`.

    On Windows, `localhost` often resolves to IPv6 `::1` first. Python's `urllib` connects to that
    address and blocks — it does NOT fall back to IPv4 the way `curl` and browsers do — so a request
    to a server bound only to IPv4 `127.0.0.1` (Ollama's default) hangs until the socket times out.
    Forcing the IPv4 loopback makes local LLM calls return instantly. Only the loopback name is
    rewritten; real hostnames are left untouched.
    """
    return base_url.replace("//localhost:", "//127.0.0.1:").replace(
        "//localhost/", "//127.0.0.1/"
    )


class LLMError(Exception):
    pass


def _resolve_models(model: str | None, models: list[str] | None) -> list[str]:
    """Build the ordered model list: explicit `models`, else LLM_MODEL + LLM_FALLBACK_MODELS."""
    if models:
        chosen = list(models)
    else:
        primary = model or os.environ.get("LLM_MODEL") or DEFAULT_MODEL
        raw = os.environ.get("LLM_FALLBACK_MODELS", "")
        fallbacks = [m.strip() for m in raw.split(",") if m.strip()]
        chosen = [primary, *fallbacks]
    seen: set[str] = set()
    ordered = [m for m in chosen if not (m in seen or seen.add(m))]
    return ordered or [DEFAULT_MODEL]


class LLM:
    def __init__(
        self,
        *,
        provider: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        models: list[str] | None = None,
        api_key: str | None = None,
        system: str | None = None,
        temperature: float = 0.4,
        max_tokens: int = 1024,
        timeout: float = 120.0,
    ) -> None:
        name = (provider or os.environ.get("LLM_PROVIDER") or "local").lower()
        preset = PROVIDERS.get(name, PROVIDERS["local"])
        self.provider_name = name if name in PROVIDERS else "local"
        self.kind = preset["kind"]
        self.base_url = _prefer_ipv4(
            (base_url or os.environ.get("LLM_BASE_URL") or preset["base_url"]).rstrip("/")
        )
        self.models = _resolve_models(model, models)
        # BYOK — a key you supply. "ollama" is a harmless dummy for local servers that ignore it.
        self.api_key = api_key or os.environ.get("LLM_API_KEY") or "ollama"
        self.system = system
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.used_model: str | None = None

    @classmethod
    def provider(cls, name: str, **kwargs: object) -> LLM:
        """Convenience: `LLM.provider("openrouter", model=..., api_key=...)`."""
        return cls(provider=name, **kwargs)  # type: ignore[arg-type]

    @property
    def model(self) -> str:
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
            f"all models failed via '{self.provider_name}' at {self.base_url}. Is the server "
            f"reachable and are the models available?\n" + "\n".join(errors)
        )

    def _chat_once(self, model: str, prompt: str) -> str:
        if self.kind == "anthropic":
            return self._chat_anthropic(model, prompt)
        return self._chat_openai(model, prompt)

    def _post(self, url: str, headers: dict[str, str], payload: dict[str, object]) -> dict:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
        for key, value in headers.items():
            req.add_header(key, value)
        opener = _opener_for(url)
        try:
            with opener.open(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - surface any transport/HTTP error uniformly
            raise LLMError(str(exc)) from exc

    def _chat_openai(self, model: str, prompt: str) -> str:
        messages: list[dict[str, str]] = []
        if self.system:
            messages.append({"role": "system", "content": self.system})
        messages.append({"role": "user", "content": prompt})
        data = self._post(
            f"{self.base_url}/chat/completions",
            {"content-type": "application/json", "authorization": f"Bearer {self.api_key}"},
            {
                "model": model,
                "messages": messages,
                "temperature": self.temperature,
                "stream": False,
            },
        )
        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"unexpected response shape: {data!r}") from exc

    def _chat_anthropic(self, model: str, prompt: str) -> str:
        payload: dict[str, object] = {
            "model": model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if self.system:
            payload["system"] = self.system
        data = self._post(
            f"{self.base_url}/v1/messages",
            {
                "content-type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
            payload,
        )
        try:
            return data["content"][0]["text"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"unexpected response shape: {data!r}") from exc
