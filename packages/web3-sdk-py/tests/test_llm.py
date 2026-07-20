"""Unit tests for the LLM client config and the .env loader."""

import os

from web3_sdk import LLM, load_env


def test_llm_defaults(monkeypatch) -> None:
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm = LLM()
    # IPv4 loopback, not "localhost": on Windows "localhost" can resolve to IPv6 ::1 where a
    # local Ollama isn't listening, and urllib hangs on it.
    assert llm.base_url == "http://127.0.0.1:11434/v1"
    assert llm.model == "qwen2.5:7b"


def test_localhost_is_rewritten_to_ipv4(monkeypatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    assert LLM().base_url == "http://127.0.0.1:11434/v1"


def test_llm_reads_env_and_strips_trailing_slash(monkeypatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "http://example.local:8000/v1/")
    monkeypatch.setenv("LLM_MODEL", "qwen2.5:14b")
    llm = LLM()
    assert llm.base_url == "http://example.local:8000/v1"
    assert llm.model == "qwen2.5:14b"


def test_llm_explicit_args_win(monkeypatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "from-env")
    llm = LLM(model="explicit")
    assert llm.model == "explicit"


def test_fallback_models_from_env(monkeypatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "qwen2.5:7b")
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "llama3.1, mistral , ")
    llm = LLM()
    assert llm.models == ["qwen2.5:7b", "llama3.1", "mistral"]
    assert llm.model == "qwen2.5:7b"


def test_fallback_models_are_deduped(monkeypatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "a")
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "a,b,b,c")
    assert LLM().models == ["a", "b", "c"]


def test_explicit_models_list_wins(monkeypatch) -> None:
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "ignored")
    assert LLM(models=["x", "y"]).models == ["x", "y"]


def test_provider_presets(monkeypatch) -> None:
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert LLM.provider("openrouter").base_url == "https://openrouter.ai/api/v1"
    assert LLM.provider("openai").base_url == "https://api.openai.com/v1"
    assert LLM.provider("local").base_url == "http://127.0.0.1:11434/v1"
    anthropic = LLM.provider("anthropic")
    assert anthropic.base_url == "https://api.anthropic.com"
    assert anthropic.kind == "anthropic"


def test_provider_from_env(monkeypatch) -> None:
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    assert LLM().base_url == "https://api.groq.com/openai/v1"


def test_unknown_provider_falls_back_to_local(monkeypatch) -> None:
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    llm = LLM(provider="nope")
    assert llm.provider_name == "local"
    assert llm.kind == "openai"


def test_explicit_base_url_overrides_preset() -> None:
    llm = LLM(provider="openai", base_url="http://127.0.0.1:9/v1")
    assert llm.base_url == "http://127.0.0.1:9/v1"


def test_loopback_calls_bypass_proxy(monkeypatch) -> None:
    """A loopback URL must not be routed through a configured HTTP proxy (else it hangs on Windows);
    hosted providers must still honour the proxy so firewalled users can reach them."""
    import urllib.request

    from web3_sdk.llm import _opener_for

    monkeypatch.setenv("HTTP_PROXY", "http://proxy.local:8080")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.local:8080")

    def proxies(url: str) -> dict:
        opener = _opener_for(url)
        for handler in opener.handlers:
            if isinstance(handler, urllib.request.ProxyHandler):
                return handler.proxies
        return {}

    assert proxies("http://127.0.0.1:11434/v1/chat/completions") == {}
    assert proxies("http://localhost:11434/v1/chat/completions") == {}
    hosted = proxies("https://api.openai.com/v1/chat/completions")
    assert hosted.get("http") == "http://proxy.local:8080"


def test_load_env(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text('FOO_TEST=bar\n# a comment\nBAZ_TEST="q u x"\n\n', encoding="utf-8")
    monkeypatch.delenv("FOO_TEST", raising=False)
    monkeypatch.delenv("BAZ_TEST", raising=False)

    assert load_env(env_file) is True
    assert os.environ["FOO_TEST"] == "bar"
    assert os.environ["BAZ_TEST"] == "q u x"


def test_load_env_does_not_override_existing(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("ALREADY_SET=fromfile\n", encoding="utf-8")
    monkeypatch.setenv("ALREADY_SET", "fromshell")
    load_env(env_file)
    assert os.environ["ALREADY_SET"] == "fromshell"
