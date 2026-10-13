import asyncio
import json
from typing import Any

from fastapi.testclient import TestClient

from shortlist.events import ProgressBus, RunProgress
from shortlist.pipeline.fetch import FetchError
from tests.conftest import FakeFetcher, start_run_and_wait


def read_events(client: TestClient, run_id: int) -> list[dict[str, Any]]:
    with client.stream("GET", f"/api/runs/{run_id}/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        return [json.loads(line[5:]) for line in response.iter_lines() if line.startswith("data:")]


def test_bus_sends_current_progress_then_every_change_until_done() -> None:
    async def scenario() -> list[RunProgress]:
        bus = ProgressBus()
        bus.start(1, ["indeed", "stepstone"])
        bus.source(1, "indeed", "fetching")
        received: list[RunProgress] = []

        async def listen() -> None:
            received.extend([progress async for progress in bus.subscribe(1)])

        listener = asyncio.create_task(listen())
        await asyncio.sleep(0)
        bus.source(1, "indeed", "done", fetched=3)
        bus.source(1, "stepstone", "error", error="run FAILED")
        bus.stage(1, "deduplicating")
        bus.stage(1, "done")
        await asyncio.wait_for(listener, timeout=1)
        assert bus.latest(1) is None  # finished runs are dropped from memory
        return received

    received = asyncio.run(scenario())

    assert [p.stage for p in received] == ["fetching"] * 3 + ["deduplicating", "done"]
    assert received[0].sources["indeed"].state == "fetching"  # snapshot at subscribe time
    assert received[0].sources["stepstone"].state == "pending"
    assert received[-1].sources["indeed"].model_dump() == {
        "state": "done",
        "fetched": 3,
        "error": None,
    }
    assert received[-1].sources["stepstone"].error == "run FAILED"


def test_bus_subscription_to_unknown_run_ends_immediately() -> None:
    async def scenario() -> list[RunProgress]:
        return [progress async for progress in ProgressBus().subscribe(42)]

    assert asyncio.run(scenario()) == []


def test_events_stream_follows_a_run_to_the_end(client: TestClient, fetcher: FakeFetcher) -> None:
    fetcher.delay_seconds = 0.05
    fetcher.errors["linkedin"] = FetchError("actor: run FAILED")
    run_id = client.post("/api/runs", json={"limits": {"linkedin": 4, "stepstone": 5}}).json()["id"]

    events = read_events(client, run_id)

    assert events[0]["stage"] == "fetching"
    assert [event["stage"] for event in events][-1] == "done"
    assert "deduplicating" in [event["stage"] for event in events]
    states = [event["sources"]["stepstone"]["state"] for event in events]
    assert "fetching" in states
    assert "normalizing" in states
    assert events[-1]["sources"]["stepstone"] == {"state": "done", "fetched": 5, "error": None}
    assert events[-1]["sources"]["linkedin"]["state"] == "error"
    assert "run FAILED" in events[-1]["sources"]["linkedin"]["error"]


def test_events_of_a_finished_run_are_one_final_snapshot(client: TestClient) -> None:
    run = start_run_and_wait(client, {"indeed": 3})

    events = read_events(client, run["id"])

    assert events == [
        {
            "run_id": run["id"],
            "stage": "done",
            "sources": {"indeed": {"state": "done", "fetched": 3, "error": None}},
            "llm_done": 3,
            "llm_total": 3,
        }
    ]
