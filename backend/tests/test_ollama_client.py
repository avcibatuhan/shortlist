import asyncio
import json
from typing import Any

import httpx2
import pytest

from shortlist.llm.ollama_client import LLMUnavailable, OllamaClient

SCHEMA: dict[str, Any] = {"type": "object"}


def client_with(handler: Any) -> OllamaClient:
    return OllamaClient("http://ollama.test", transport=httpx2.MockTransport(handler))


def chat(client: OllamaClient, model: str = "qwen3.5:9b") -> str:
    return asyncio.run(client.chat_json(model, "system text", "user text", SCHEMA))


def test_chat_sends_schema_and_deterministic_options_with_thinking_off() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(json.loads(request.content))
        assert request.url.path == "/api/chat"
        return httpx2.Response(200, json={"message": {"content": '{"match": true}'}})

    assert chat(client_with(handler)) == '{"match": true}'
    assert seen == [
        {
            "model": "qwen3.5:9b",
            "stream": False,
            "think": False,
            "format": SCHEMA,
            "options": {"temperature": 0, "seed": 42, "num_ctx": 8192},
            "messages": [
                {"role": "system", "content": "system text"},
                {"role": "user", "content": "user text"},
            ],
        }
    ]


def test_model_without_thinking_mode_is_asked_again_without_the_option() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "think" in body:
            return httpx2.Response(400, json={"error": '"some-model" does not support thinking'})
        return httpx2.Response(200, json={"message": {"content": "ok"}})

    client = client_with(handler)

    assert chat(client, "some-model") == "ok"
    assert chat(client, "some-model") == "ok"
    assert ["think" in body for body in bodies] == [True, False, False]  # remembered


def test_unreachable_server_is_unavailable() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused")

    with pytest.raises(LLMUnavailable, match=r"not reachable at http://ollama\.test"):
        chat(client_with(handler))


def test_missing_model_says_how_to_install_it() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(404, json={"error": "model 'x:1b' not found"})

    with pytest.raises(LLMUnavailable, match="ollama pull x:1b"):
        chat(client_with(handler), "x:1b")


def test_other_error_status_is_unavailable() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(500, text="out of memory")

    with pytest.raises(LLMUnavailable, match="500: out of memory"):
        chat(client_with(handler))


def test_model_status_reports_gpu_share() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/api/ps"
        loaded = {"name": "qwen3.5:9b", "size": 4000, "size_vram": 3000, "context_length": 8192}
        return httpx2.Response(200, json={"models": [loaded]})

    client = client_with(handler)
    status = asyncio.run(client.model_status("qwen3.5:9b"))

    assert status is not None
    assert (status.gpu_percent, status.context_length) == (75, 8192)
    assert asyncio.run(client.model_status("other:1b")) is None


def test_chat_text_has_no_schema_or_seed_and_caps_the_length() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(json.loads(request.content))
        return httpx2.Response(200, json={"message": {"content": "Sehr geehrte Damen und Herren,"}})

    client = client_with(handler)
    text = asyncio.run(
        client.chat_text("qwen3.5:9b", "system text", "user text", temperature=0.4, max_tokens=900)
    )

    assert text == "Sehr geehrte Damen und Herren,"
    (body,) = seen
    assert "format" not in body
    assert body["options"] == {"temperature": 0.4, "num_ctx": 8192, "num_predict": 900}
    assert body["think"] is False


def test_list_models_returns_installed_names_sorted() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/api/tags"
        return httpx2.Response(
            200, json={"models": [{"name": "qwen3.5:9b"}, {"name": "gemma4:e4b"}]}
        )

    assert asyncio.run(client_with(handler).list_models()) == ["gemma4:e4b", "qwen3.5:9b"]


def test_list_models_when_the_server_is_down() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused")

    with pytest.raises(LLMUnavailable, match="not reachable"):
        asyncio.run(client_with(handler).list_models())
