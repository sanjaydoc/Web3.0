"""Unit tests for the LLM client config and the .env loader."""

import os

from acp_sdk import LLM, load_env


def test_llm_defaults(monkeypatch) -> None:
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm = LLM()
    assert llm.base_url == "http://localhost:11434/v1"
    assert llm.model == "qwen2.5:7b"


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
