"""Ollama HTTP API client (https://docs.ollama.com/api). Verified against Ollama 0.40."""

from typing import Any, Protocol

import httpx2
from pydantic import BaseModel

# Enough for the profile plus a 6,000-character description; Ollama's default is much smaller.
NUM_CTX = 8192
SEED = 42
REQUEST_TIMEOUT_SECONDS = 180.0  # includes loading the model into VRAM on the first call


class LLMUnavailable(Exception):
    """Ollama cannot be reached, or the model cannot be used. Retrying per job is pointless."""


class ModelStatus(BaseModel):
    """How the loaded model is placed, from `ollama ps`."""

    size_bytes: int
    vram_bytes: int
    context_length: int | None

    @property
    def gpu_percent(self) -> int:
        return round(100 * self.vram_bytes / self.size_bytes) if self.size_bytes else 0


class LLMClient(Protocol):
    async def chat_json(self, model: str, system: str, user: str, schema: dict[str, Any]) -> str:
        """The model's raw answer to one request; the caller validates it.

        Raises LLMUnavailable when the server or the model cannot be used.
        """
        ...

    async def chat_text(
        self, model: str, system: str, user: str, *, temperature: float, max_tokens: int
    ) -> str:
        """Free text from the model, at most `max_tokens` long.

        Raises LLMUnavailable when the server or the model cannot be used.
        """
        ...

    async def model_status(self, model: str) -> ModelStatus | None:
        """Placement of the model if it is currently loaded, else None."""
        ...

    async def list_models(self) -> list[str]:
        """Names of the installed models. Raises LLMUnavailable when the server is down."""
        ...


class OllamaClient:
    def __init__(self, base_url: str, transport: httpx2.AsyncBaseTransport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._transport = transport
        # Models without a thinking mode reject the `think` option; remembered per model.
        self._no_think_option: set[str] = set()

    def _http(self) -> httpx2.AsyncClient:
        return httpx2.AsyncClient(
            base_url=self._base_url, timeout=REQUEST_TIMEOUT_SECONDS, transport=self._transport
        )

    async def chat_json(self, model: str, system: str, user: str, schema: dict[str, Any]) -> str:
        # Deterministic and fast: a yes/no decision needs no reasoning pass.
        options = {"temperature": 0, "seed": SEED, "num_ctx": NUM_CTX}
        return await self._chat(model, system, user, options, schema)

    async def chat_text(
        self, model: str, system: str, user: str, *, temperature: float, max_tokens: int
    ) -> str:
        # No seed: writing the same letter again should give a new draft.
        options = {"temperature": temperature, "num_ctx": NUM_CTX, "num_predict": max_tokens}
        return await self._chat(model, system, user, options, None)

    async def _chat(
        self,
        model: str,
        system: str,
        user: str,
        options: dict[str, Any],
        schema: dict[str, Any] | None,
    ) -> str:
        body: dict[str, Any] = {
            "model": model,
            "stream": False,
            "options": options,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if schema is not None:
            body["format"] = schema
        if model not in self._no_think_option:
            body["think"] = False
        try:
            async with self._http() as http:
                response = await http.post("/api/chat", json=body)
                if response.status_code == 400 and "think" in response.text and "think" in body:
                    self._no_think_option.add(model)
                    del body["think"]
                    response = await http.post("/api/chat", json=body)
        except httpx2.TransportError as exc:
            raise self._unreachable(exc) from exc
        if response.status_code == 404:
            raise LLMUnavailable(f'Model "{model}" is not installed. Run: ollama pull {model}')
        if response.status_code != 200:
            raise LLMUnavailable(f"Ollama answered {response.status_code}: {response.text[:200]}")
        content = response.json().get("message", {}).get("content")
        return content if isinstance(content, str) else ""

    def _unreachable(self, exc: Exception) -> LLMUnavailable:
        return LLMUnavailable(
            f"Ollama is not reachable at {self._base_url} ({type(exc).__name__})."
        )

    async def list_models(self) -> list[str]:
        try:
            async with self._http() as http:
                response = await http.get("/api/tags")
        except httpx2.TransportError as exc:
            raise self._unreachable(exc) from exc
        if response.status_code != 200:
            raise LLMUnavailable(f"Ollama answered {response.status_code}: {response.text[:200]}")
        names = [model.get("name") for model in response.json().get("models", [])]
        return sorted(name for name in names if isinstance(name, str))

    async def model_status(self, model: str) -> ModelStatus | None:
        try:
            async with self._http() as http:
                response = await http.get("/api/ps")
        except httpx2.TransportError:
            return None
        if response.status_code != 200:
            return None
        for loaded in response.json().get("models", []):
            if loaded.get("name") == model or loaded.get("model") == model:
                return ModelStatus(
                    size_bytes=loaded.get("size", 0),
                    vram_bytes=loaded.get("size_vram", 0),
                    context_length=loaded.get("context_length"),
                )
        return None
