import asyncio
import json
import time
from collections.abc import Callable, Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from shortlist.db import make_engine, run_migrations
from shortlist.llm.ollama_client import LLMUnavailable, ModelStatus
from shortlist.main import create_app
from shortlist.sources import SOURCES
from shortlist.sources.base import RawItem

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> list[RawItem]:
    items: list[RawItem] = json.loads((FIXTURES / name).read_text())
    return items


ACTOR_SOURCES = {source.actor_id: name for name, source in SOURCES.items()}


class FakeFetcher:
    """Stands in for Apify: tests never call a paid Actor.

    `items` holds each source's results; every search gets the next ones, at most its limit.
    """

    def __init__(self, items: dict[str, list[RawItem]] | None = None) -> None:
        self.items = items if items is not None else {}
        self.errors: dict[str, Exception] = {}  # source -> every call of it fails
        self.error_sequence: list[Exception | None] = []  # consumed call by call, any source
        self.results_per_call: dict[int, int] = {}  # n-th call of a source -> results it has
        self.delay_seconds = 0.0
        self.calls: list[dict[str, Any]] = []
        self._served: dict[str, int] = {}

    def reset(self) -> None:
        """Serve the same results again, as a second run on the same day would."""
        self.calls.clear()
        self._served.clear()

    def calls_of(self, source: str) -> list[dict[str, Any]]:
        return [call for call in self.calls if call["source"] == source]

    async def fetch(
        self, actor_id: str, run_input: RawItem, limit: int, max_charge_usd: Decimal
    ) -> list[RawItem]:
        source = ACTOR_SOURCES[actor_id]
        call_index = len(self.calls_of(source))
        self.calls.append(
            {
                "source": source,
                "actor_id": actor_id,
                "run_input": run_input,
                "limit": limit,
                "max_charge_usd": max_charge_usd,
            }
        )
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)
        error = self.error_sequence.pop(0) if self.error_sequence else self.errors.get(source)
        if error is not None:
            raise error
        count = min(limit, self.results_per_call.get(call_index, limit))
        served = self._served.get(source, 0)
        self._served[source] = served + count
        return self.items.get(source, [])[served : served + count]


YES = '{"match": true, "reason": "Fits the profile."}'
NO = '{"match": false, "reason": "Different field."}'


class FakeLLM:
    """Stands in for Ollama. By default every job is a match; `respond` decides per prompt,
    `answers` (if set) are returned first, one per request."""

    def __init__(self) -> None:
        self.answers: list[str] = []
        self.respond: Callable[[str], str] = lambda prompt: YES
        self.unavailable: LLMUnavailable | None = None
        self.calls: list[dict[str, Any]] = []

    async def chat_json(self, model: str, system: str, user: str, schema: dict[str, Any]) -> str:
        self.calls.append({"model": model, "system": system, "user": user, "schema": schema})
        if self.unavailable is not None:
            raise self.unavailable
        return self.answers.pop(0) if self.answers else self.respond(user)

    async def chat_text(
        self, model: str, system: str, user: str, *, temperature: float, max_tokens: int
    ) -> str:
        self.calls.append(
            {
                "model": model,
                "system": system,
                "user": user,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
        )
        if self.unavailable is not None:
            raise self.unavailable
        return self.answers.pop(0) if self.answers else self.respond(user)

    async def model_status(self, model: str) -> ModelStatus | None:
        if self.unavailable is not None:
            return None
        return ModelStatus(size_bytes=1000, vram_bytes=1000, context_length=8192)

    async def list_models(self) -> list[str]:
        if self.unavailable is not None:
            raise self.unavailable
        return ["gemma4:12b-it-qat", "qwen3.5:9b"]


BASE_URL = "http://127.0.0.1:8000"


def local_client(app: FastAPI) -> TestClient:
    """A client that reaches the app the way the browser does, by its local address."""
    return TestClient(app, base_url=BASE_URL)


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture
def engine(database_url: str) -> Iterator[Engine]:
    """Empty database, no schema."""
    engine = make_engine(database_url)
    yield engine
    engine.dispose()


@pytest.fixture
def migrated_engine(engine: Engine, database_url: str) -> Engine:
    run_migrations(database_url)
    return engine


@pytest.fixture
def fetcher() -> FakeFetcher:
    return FakeFetcher({name: load_fixture(f"{name}.json") for name in SOURCES})


@pytest.fixture
def llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def raw_dir(tmp_path: Path) -> Path:
    return tmp_path / "raw"


@pytest.fixture
def client(
    migrated_engine: Engine, fetcher: FakeFetcher, llm: FakeLLM, raw_dir: Path
) -> Iterator[TestClient]:
    app = create_app(
        frontend_dist=None,
        engine=migrated_engine,
        fetcher=fetcher,
        llm=llm,
        raw_dir=raw_dir,
        retry_backoff_seconds=0,
    )
    # The context manager keeps one event loop alive, so background runs can finish.
    with local_client(app) as client:
        yield client


def start_run_and_wait(client: TestClient, limits: dict[str, int], **body: Any) -> dict[str, Any]:
    response = client.post("/api/runs", json={"limits": limits, **body})
    assert response.status_code == 202, response.text
    run_id = response.json()["id"]
    for _ in range(200):
        run: dict[str, Any] = client.get(f"/api/runs/{run_id}").json()
        if run["state"] != "running":
            return run
        time.sleep(0.01)
    raise AssertionError("run did not finish")
