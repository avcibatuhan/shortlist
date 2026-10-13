import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlmodel import Session

from shortlist.api import runs
from shortlist.config import AppConfig
from shortlist.main import create_app
from shortlist.models import Run
from shortlist.pipeline.fetch import FetchError, TransientFetchError
from tests.conftest import FakeFetcher, local_client, start_run_and_wait

ALL_SOURCES = {"linkedin": 4, "indeed": 3, "stepstone": 5}


def test_run_fetches_and_stores_jobs(client: TestClient, raw_dir: Path) -> None:
    run = start_run_and_wait(client, {"stepstone": 5})

    assert run["state"] == "done"
    assert run["limits"] == {"stepstone": 5}
    assert (run["fetched"], run["new"]) == (5, 5)
    assert run["errors"] == {}
    assert run["finished_at"] is not None

    jobs = client.get("/api/jobs").json()
    assert len(jobs) == 5
    assert jobs[0]["title"] == "Softwareentwickler (m/w/d)"
    assert jobs[0]["status"] == "new"
    assert jobs[0]["description_is_snippet"] is True
    assert jobs[0]["sources"] == [
        {
            "source": "stepstone",
            "url": "https://www.stepstone.de/jobs--Softwareentwickler-m-w-d-Bad-Musterstadt-bei"
            "-Karlsruhe-Beispiel-Maschinenbau-GmbH--10000001-inline.html",
        }
    ]
    assert len(json.loads((raw_dir / str(run["id"]) / "stepstone.json").read_text())) == 5


def test_limit_is_split_across_searches_and_always_passed(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    start_run_and_wait(client, {"stepstone": 5})

    assert [call["limit"] for call in fetcher.calls] == [2, 2, 1]
    assert [call["run_input"]["maxItems"] for call in fetcher.calls] == [2, 2, 1]
    assert {call["actor_id"] for call in fetcher.calls} == {"memo23/stepstone-search-cheerio-ppr"}


def test_unused_share_of_a_search_is_passed_to_the_next(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    fetcher.results_per_call = {0: 0, 1: 1}  # first search finds nothing, second only one

    run = start_run_and_wait(client, {"stepstone": 5})

    assert [call["limit"] for call in fetcher.calls] == [2, 4, 4]
    assert run["fetched"] == 5


def test_search_without_a_share_is_not_started(client: TestClient, fetcher: FakeFetcher) -> None:
    run = start_run_and_wait(client, {"stepstone": 2})

    assert [call["limit"] for call in fetcher.calls] == [1, 1]
    assert run["fetched"] == 2


def test_every_actor_run_has_a_charge_cap_and_cost_is_recorded(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    run = start_run_and_wait(client, {"stepstone": 5})

    # Per search: (start $0.005 + results x $0.001) x 1.2, rounded up to a cent.
    assert [call["max_charge_usd"] for call in fetcher.calls] == [Decimal("0.01")] * 3
    # 3 starts x $0.005 + 5 results x $0.001
    assert run["estimated_cost_usd"] == pytest.approx(0.02)
    assert run["sources"]["stepstone"]["cost_usd"] == pytest.approx(0.02)
    assert run["sources"]["stepstone"]["starts"] == 3


def test_failed_starts_still_count_towards_cost(client: TestClient, fetcher: FakeFetcher) -> None:
    fetcher.errors["stepstone"] = FetchError("actor: run ABORTED")

    run = start_run_and_wait(client, {"stepstone": 5})

    assert run["estimated_cost_usd"] == pytest.approx(0.015)


# --- all sources, failure isolation -------------------------------------------------------


def test_all_sources_are_fetched_and_every_item_is_accounted_for(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    run = start_run_and_wait(client, ALL_SOURCES)

    assert run["state"] == "done"
    assert run["fetched"] == 12
    # LinkedIn lists one job twice; StepStone has two jobs that LinkedIn / Indeed already gave.
    assert run["sources"]["linkedin"] | {"cost_usd": 0} == {
        "limit": 4, "fetched": 4, "skipped": 0, "duplicates": 1, "known": 0, "new": 3,
        "starts": 3, "cost_usd": 0,
    }  # fmt: skip
    assert (run["sources"]["indeed"]["new"], run["sources"]["indeed"]["duplicates"]) == (3, 0)
    assert (run["sources"]["stepstone"]["new"], run["sources"]["stepstone"]["duplicates"]) == (3, 2)
    assert (run["new"], run["duplicates_in_run"], run["already_known"], run["skipped"]) == (
        9,
        3,
        0,
        0,
    )
    assert run["fetched"] == (
        run["new"] + run["duplicates_in_run"] + run["already_known"] + run["skipped"]
    )
    assert {call["source"] for call in fetcher.calls} == set(ALL_SOURCES)


def test_same_job_from_several_sources_is_one_job_with_several_links(client: TestClient) -> None:
    start_run_and_wait(client, ALL_SOURCES)

    jobs = {job["title"]: job for job in client.get("/api/jobs").json()}
    assert len(jobs) == 9
    shared = jobs["Software Engineer (m/f/d)"]
    assert sorted(source["source"] for source in shared["sources"]) == ["linkedin", "stepstone"]
    assert shared["description_is_snippet"] is False  # the first source seen keeps its data
    twice = jobs["Java Software Developer (w/m/d) Communication Platform"]
    assert [source["source"] for source in twice["sources"]] == ["linkedin", "linkedin"]


def test_second_run_finds_nothing_new_and_explains_why(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    start_run_and_wait(client, ALL_SOURCES)
    fetcher.reset()

    second = start_run_and_wait(client, ALL_SOURCES)

    assert (second["fetched"], second["new"]) == (12, 0)
    assert (second["already_known"], second["duplicates_in_run"]) == (12, 0)
    assert {name: stats["known"] for name, stats in second["sources"].items()} == ALL_SOURCES
    assert len(client.get("/api/jobs").json()) == 9


def test_one_failing_source_does_not_stop_the_others(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    fetcher.errors["linkedin"] = FetchError("actor: run FAILED")

    run = start_run_and_wait(client, ALL_SOURCES)

    assert run["state"] == "partial"
    assert "run FAILED" in run["errors"]["linkedin"]
    assert set(run["errors"]) == {"linkedin"}
    assert run["sources"]["linkedin"]["fetched"] == 0
    assert (run["sources"]["indeed"]["fetched"], run["sources"]["stepstone"]["fetched"]) == (3, 5)


def test_run_fails_when_every_source_fails(client: TestClient, fetcher: FakeFetcher) -> None:
    for name in ALL_SOURCES:
        fetcher.errors[name] = FetchError("actor: run FAILED")

    run = start_run_and_wait(client, ALL_SOURCES)

    assert run["state"] == "failed"
    assert set(run["errors"]) == set(ALL_SOURCES)
    assert client.get("/api/jobs").json() == []


def test_unreadable_items_make_the_run_partial(client: TestClient, fetcher: FakeFetcher) -> None:
    fetcher.items["stepstone"] = [fetcher.items["stepstone"][0], {"title": "no id"}]

    run = start_run_and_wait(client, {"stepstone": 2})

    assert run["state"] == "partial"
    assert (run["fetched"], run["new"], run["skipped"]) == (2, 1, 1)
    assert "1 item(s)" in run["errors"]["stepstone"]


# --- retries ------------------------------------------------------------------------------


def test_transient_error_is_retried_once(client: TestClient, fetcher: FakeFetcher) -> None:
    fetcher.error_sequence = [TransientFetchError("ServerError: 502")]

    run = start_run_and_wait(client, {"stepstone": 5})

    assert run["state"] == "done"
    assert run["fetched"] == 5
    assert len(fetcher.calls) == 4  # first search twice
    assert run["sources"]["stepstone"]["starts"] == 4


def test_transient_error_twice_fails_that_search_only(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    fetcher.error_sequence = [TransientFetchError("502"), TransientFetchError("502")]

    run = start_run_and_wait(client, {"stepstone": 5})

    assert run["state"] == "partial"
    assert run["fetched"] == 5  # the failed search's share went to the next ones
    assert len(fetcher.calls) == 4


def test_other_errors_are_not_retried(client: TestClient, fetcher: FakeFetcher) -> None:
    fetcher.error_sequence = [FetchError("input is not valid")]

    start_run_and_wait(client, {"stepstone": 5})

    assert len(fetcher.calls) == 3


# --- prefilter ----------------------------------------------------------------------------


def test_excluded_titles_are_filtered_out_but_kept(
    client: TestClient, fetcher: FakeFetcher
) -> None:
    first = fetcher.items["stepstone"][0]
    fetcher.items["stepstone"][0] = {**first, "title": "Werkstudent Softwareentwicklung (m/w/d)"}

    run = start_run_and_wait(client, {"stepstone": 5})

    assert (run["new"], run["prefiltered_out"]) == (5, 1)
    (filtered,) = client.get("/api/jobs", params={"filtered": True}).json()
    assert filtered["filter_reason"] == 'Title contains "Werkstudent"'
    kept = client.get("/api/jobs", params={"filtered": False}).json()
    assert len(kept) == 4
    assert all(job["filter_reason"] is None for job in kept)


# --- validation and run lifecycle ---------------------------------------------------------


def test_run_requires_explicit_valid_limits(client: TestClient) -> None:
    assert client.post("/api/runs", json={"limits": {}}).status_code == 422
    assert client.post("/api/runs", json={"limits": {"stepstone": 0}}).status_code == 422
    assert client.post("/api/runs", json={"limits": {"stepstone": 1001}}).status_code == 422
    assert client.post("/api/runs", json={}).status_code == 422


def test_unknown_source_is_rejected(client: TestClient) -> None:
    response = client.post("/api/runs", json={"limits": {"xing": 5}})

    assert response.status_code == 400
    assert "xing" in response.json()["detail"]


def test_only_one_run_at_a_time(client: TestClient, migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        session.add(Run(started_at=datetime.now(UTC), state="running"))
        session.commit()

    response = client.post("/api/runs", json={"limits": {"stepstone": 5}})

    assert response.status_code == 409
    assert "already active" in response.json()["detail"]


def test_missing_token_is_reported(
    migrated_engine: Engine, raw_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(runs, "get_config", lambda: AppConfig(_env_file=None, apify_token=None))
    app = create_app(frontend_dist=None, engine=migrated_engine, raw_dir=raw_dir)
    with local_client(app) as client:
        response = client.post("/api/runs", json={"limits": {"stepstone": 5}})

    assert response.status_code == 400
    assert "APIFY_TOKEN" in response.json()["detail"]


def test_interrupted_run_is_failed_on_startup(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        session.add(Run(started_at=datetime.now(UTC), state="running"))
        session.commit()

    with local_client(create_app(frontend_dist=None, engine=migrated_engine)) as client:
        (run,) = client.get("/api/runs").json()

    assert run["state"] == "failed"
    assert "Interrupted" in run["errors"]["run"]


def test_unknown_run_is_404(client: TestClient) -> None:
    assert client.get("/api/runs/999").status_code == 404
    assert client.get("/api/runs/999/events").status_code == 404
