import time
from typing import Any

from fastapi.testclient import TestClient

from shortlist.llm.ollama_client import LLMUnavailable
from tests.conftest import NO, YES, FakeFetcher, FakeLLM, start_run_and_wait
from tests.test_events import read_events


def by_title(prompt: str) -> str:
    """Yes for the first StepStone fixture job only."""
    return YES if "Title: Softwareentwickler (m/w/d)\n" in prompt else NO


def titles(client: TestClient, **params: Any) -> list[str]:
    return [job["title"] for job in client.get("/api/jobs", params=params).json()]


def wait_for_reevaluation(client: TestClient) -> dict[str, Any]:
    for _ in range(200):
        status: dict[str, Any] = client.get("/api/match/status").json()
        if not status["running"]:
            return status
        time.sleep(0.01)
    raise AssertionError("re-evaluation did not finish")


def test_new_jobs_are_decided_and_counted(client: TestClient, llm: FakeLLM) -> None:
    llm.respond = by_title
    llm.answers = ["not json", "still not json"]  # first job: invalid twice -> undecided

    run = start_run_and_wait(client, {"stepstone": 5})

    assert (run["matched"], run["not_matched"], run["undecided"]) == (0, 4, 1)
    assert run["matched"] + run["not_matched"] + run["undecided"] == run["new"] == 5
    assert len(llm.calls) == 6  # 5 jobs + 1 retry
    assert titles(client, decision="undecided") == ["Softwareentwickler (m/w/d)"]


def test_jobs_are_listed_by_decision_with_the_reason(client: TestClient, llm: FakeLLM) -> None:
    llm.respond = by_title
    start_run_and_wait(client, {"stepstone": 5})

    (match,) = client.get("/api/jobs", params={"decision": "match"}).json()
    assert match["title"] == "Softwareentwickler (m/w/d)"
    assert (match["match"], match["match_reason"]) == (True, "Fits the profile.")
    rejected = client.get("/api/jobs", params={"decision": "no_match"}).json()
    assert len(rejected) == 4
    assert {job["match_reason"] for job in rejected} == {"Different field."}
    assert titles(client, decision="undecided") == []


def test_profile_and_model_come_from_settings(client: TestClient, llm: FakeLLM) -> None:
    settings = client.get("/api/settings").json()
    client.put("/api/settings", json={**settings, "model_name": "gemma4:e4b"})

    start_run_and_wait(client, {"stepstone": 1})

    (call,) = llm.calls
    assert call["model"] == "gemma4:e4b"
    assert "Background in manufacturing software" in call["user"]
    assert "only a short snippet" in call["user"]  # StepStone


def test_prefiltered_jobs_never_reach_the_llm(
    client: TestClient, fetcher: FakeFetcher, llm: FakeLLM
) -> None:
    first = fetcher.items["stepstone"][0]
    fetcher.items["stepstone"][0] = {**first, "title": "Werkstudent Softwareentwicklung"}

    run = start_run_and_wait(client, {"stepstone": 5})

    assert len(llm.calls) == 4
    assert (run["prefiltered_out"], run["matched"]) == (1, 4)
    assert not any("Werkstudent" in call["user"] for call in llm.calls)
    assert "Werkstudent Softwareentwicklung" not in titles(client, decision="undecided")


def test_known_jobs_are_not_sent_to_the_llm_again(
    client: TestClient, fetcher: FakeFetcher, llm: FakeLLM
) -> None:
    start_run_and_wait(client, {"linkedin": 4, "indeed": 3, "stepstone": 5})
    assert len(llm.calls) == 9  # 12 fetched, 9 different jobs
    fetcher.reset()
    llm.calls.clear()

    second = start_run_and_wait(client, {"linkedin": 4, "indeed": 3, "stepstone": 5})

    assert llm.calls == []
    assert (second["matched"], second["not_matched"], second["undecided"]) == (0, 0, 0)


def test_run_without_ollama_keeps_all_jobs_as_undecided(client: TestClient, llm: FakeLLM) -> None:
    llm.unavailable = LLMUnavailable("Ollama is not reachable at http://127.0.0.1:11434.")

    run = start_run_and_wait(client, {"stepstone": 5})

    assert run["state"] == "done"  # fetching worked; the decisions can be made later
    assert (run["new"], run["undecided"], run["matched"]) == (5, 5, 0)
    assert len(llm.calls) == 1  # not tried again for every job
    undecided = client.get("/api/jobs", params={"decision": "undecided"}).json()
    assert len(undecided) == 5
    assert all("not reachable" in job["match_reason"] for job in undecided)
    assert all(job["match"] is None for job in undecided)


def test_progress_reports_the_llm_stage(client: TestClient, fetcher: FakeFetcher) -> None:
    fetcher.delay_seconds = 0.05
    run_id = client.post("/api/runs", json={"limits": {"stepstone": 5}}).json()["id"]

    events = read_events(client, run_id)

    stages = [event["stage"] for event in events]
    assert stages.index("deduplicating") < stages.index("matching") < stages.index("done")
    matching = [(e["llm_done"], e["llm_total"]) for e in events if e["stage"] == "matching"]
    assert matching[-1] == (5, 5)
    assert (0, 5) in matching
    assert (events[-1]["llm_done"], events[-1]["llm_total"]) == (5, 5)


# --- re-evaluate undecided ----------------------------------------------------------------


def test_reevaluate_decides_what_was_left_undecided(client: TestClient, llm: FakeLLM) -> None:
    llm.unavailable = LLMUnavailable("Ollama is not reachable.")
    start_run_and_wait(client, {"stepstone": 5})
    assert client.get("/api/match/status").json()["undecided_jobs"] == 5
    llm.unavailable = None
    llm.respond = by_title
    llm.calls.clear()

    started = client.post("/api/match/reevaluate")
    status = wait_for_reevaluation(client)

    assert started.status_code == 202
    assert started.json()["total"] == 5
    assert (status["done"], status["total"]) == (5, 5)
    assert (status["matched"], status["not_matched"], status["undecided"]) == (1, 4, 0)
    assert status["undecided_jobs"] == 0
    assert len(llm.calls) == 5
    assert titles(client, decision="match") == ["Softwareentwickler (m/w/d)"]


def test_reevaluate_leaves_decided_and_filtered_jobs_alone(
    client: TestClient, fetcher: FakeFetcher, llm: FakeLLM
) -> None:
    first = fetcher.items["stepstone"][0]
    fetcher.items["stepstone"][0] = {**first, "title": "Praktikum Softwareentwicklung"}
    start_run_and_wait(client, {"stepstone": 5})
    llm.calls.clear()

    status = client.post("/api/match/reevaluate").json()

    assert (status["running"], status["total"]) == (False, 0)
    assert llm.calls == []


def test_reevaluate_still_unavailable_keeps_jobs_undecided(
    client: TestClient, llm: FakeLLM
) -> None:
    llm.unavailable = LLMUnavailable("Ollama is not reachable.")
    start_run_and_wait(client, {"stepstone": 5})

    client.post("/api/match/reevaluate")
    status = wait_for_reevaluation(client)

    assert (status["undecided"], status["undecided_jobs"]) == (5, 5)


# --- model test ---------------------------------------------------------------------------


def test_model_test_reports_decision_latency_and_gpu(client: TestClient, llm: FakeLLM) -> None:
    body = client.post("/api/settings/model/test").json()

    assert body["ok"] is True
    assert (body["model_name"], body["match"], body["reason"]) == (
        "gemma4:12b-it-qat",
        True,
        "Fits the profile.",
    )
    assert body["latency_ms"] >= 0
    assert (body["gpu_percent"], body["context_length"]) == (100, 8192)
    assert "Software Developer C# / .NET" in llm.calls[0]["user"]


def test_model_test_reports_why_it_failed(client: TestClient, llm: FakeLLM) -> None:
    llm.unavailable = LLMUnavailable('Model "x:1b" is not installed. Run: ollama pull x:1b')

    body = client.post("/api/settings/model/test").json()

    assert (body["ok"], body["match"], body["gpu_percent"]) == (False, None, None)
    assert "ollama pull x:1b" in body["reason"]
