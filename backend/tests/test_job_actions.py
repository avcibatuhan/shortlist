from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlmodel import Session, select

from shortlist.api.stats import week_start
from shortlist.models import JobEvent
from tests.conftest import NO, YES, FakeFetcher, FakeLLM, start_run_and_wait


def by_title(prompt: str) -> str:
    """Yes for the first StepStone fixture job only."""
    return YES if "Title: Softwareentwickler (m/w/d)\n" in prompt else NO


@pytest.fixture
def jobs(client: TestClient, llm: FakeLLM) -> list[dict[str, Any]]:
    """Five StepStone jobs: the first is a match, the others are not."""
    llm.respond = by_title
    start_run_and_wait(client, {"stepstone": 5})
    listed: list[dict[str, Any]] = client.get("/api/jobs").json()
    return listed


def ids(client: TestClient, **params: Any) -> list[int]:
    return [job["id"] for job in client.get("/api/jobs", params=params).json()]


def patch(client: TestClient, job_id: int, **body: Any) -> dict[str, Any]:
    response = client.patch(f"/api/jobs/{job_id}", json=body)
    assert response.status_code == 200, response.text
    updated: dict[str, Any] = response.json()
    return updated


# --- status and note ----------------------------------------------------------------------


def test_status_change_is_saved_dated_and_logged(
    client: TestClient, jobs: list[dict[str, Any]], migrated_engine: Engine
) -> None:
    job_id = jobs[0]["id"]
    assert jobs[0]["status_changed_at"] is None

    updated = patch(client, job_id, status="applied")

    assert updated["status"] == "applied"
    assert updated["status_changed_at"] is not None
    assert updated["match"] is True  # the rest of the job is returned unchanged
    assert ids(client, status="new", decision="match") == []  # left Matches
    assert ids(client, tracked=True) == [job_id]
    with Session(migrated_engine) as session:
        events = session.exec(select(JobEvent)).all()
    assert [(e.job_id, e.kind, e.value) for e in events] == [(job_id, "status", "applied")]


def test_same_status_again_is_not_a_change(
    client: TestClient, jobs: list[dict[str, Any]], migrated_engine: Engine
) -> None:
    first = patch(client, jobs[0]["id"], status="saved")
    second = patch(client, jobs[0]["id"], status="saved")

    assert second["status_changed_at"] == first["status_changed_at"]
    with Session(migrated_engine) as session:
        assert len(session.exec(select(JobEvent)).all()) == 1


def test_note_is_saved_without_touching_the_status(
    client: TestClient, jobs: list[dict[str, Any]]
) -> None:
    patch(client, jobs[0]["id"], status="applied")

    updated = patch(client, jobs[0]["id"], note="  Sent CV on Monday.  ")

    assert (updated["note"], updated["status"]) == ("Sent CV on Monday.", "applied")


def test_tracker_lists_only_tracked_statuses(
    client: TestClient, jobs: list[dict[str, Any]]
) -> None:
    for job, status in zip(
        jobs, ["saved", "applied", "interview", "rejected", "ignored"], strict=True
    ):
        patch(client, job["id"], status=status)

    tracked = client.get("/api/jobs", params={"tracked": True}).json()

    assert sorted(job["status"] for job in tracked) == ["applied", "interview", "rejected", "saved"]
    assert ids(client, status="new") == []


def test_invalid_updates_are_rejected(client: TestClient, jobs: list[dict[str, Any]]) -> None:
    job_id = jobs[0]["id"]

    assert client.patch(f"/api/jobs/{job_id}", json={"status": "hired"}).status_code == 422
    assert client.patch(f"/api/jobs/{job_id}", json={"note": "x" * 2001}).status_code == 422
    assert client.patch("/api/jobs/999", json={"status": "saved"}).status_code == 404


# --- owner verdict (override / label) -----------------------------------------------------


def test_owner_can_move_a_rejected_job_to_matches(
    client: TestClient, jobs: list[dict[str, Any]], migrated_engine: Engine
) -> None:
    rejected = jobs[1]["id"]
    assert rejected in ids(client, decision="no_match")

    updated = patch(client, rejected, owner_label=True)

    assert (updated["owner_label"], updated["match"]) == (True, False)  # LLM decision is kept
    assert rejected in ids(client, decision="match")
    assert rejected not in ids(client, decision="no_match")
    with Session(migrated_engine) as session:
        (event,) = session.exec(select(JobEvent)).all()
    assert (event.kind, event.value) == ("label", "yes")


def test_owner_can_reject_a_match_and_clear_the_verdict_again(
    client: TestClient, jobs: list[dict[str, Any]]
) -> None:
    match = jobs[0]["id"]

    patch(client, match, owner_label=False)
    assert ids(client, decision="match") == []
    assert match in ids(client, decision="no_match")

    cleared = patch(client, match, owner_label=None)
    assert cleared["owner_label"] is None
    assert ids(client, decision="match") == [match]


def test_owner_verdict_decides_undecided_and_filtered_jobs(
    client: TestClient, fetcher: FakeFetcher, llm: FakeLLM
) -> None:
    first = fetcher.items["stepstone"][0]
    fetcher.items["stepstone"][0] = {**first, "title": "Werkstudent Softwareentwicklung"}
    llm.answers = ["not json", "not json"]  # the first job that reaches the LLM stays undecided
    start_run_and_wait(client, {"stepstone": 5})
    (filtered,) = ids(client, filtered=True)
    (undecided,) = ids(client, decision="undecided")

    patch(client, filtered, owner_label=True)
    patch(client, undecided, owner_label=False)

    assert ids(client, filtered=True) == []
    assert filtered in ids(client, decision="match")
    assert ids(client, decision="undecided") == []
    assert undecided in ids(client, decision="no_match")
    # A job the owner has judged is not sent to the LLM again.
    assert client.post("/api/match/reevaluate").json()["total"] == 0


def test_sending_only_a_note_does_not_clear_the_verdict(
    client: TestClient, jobs: list[dict[str, Any]]
) -> None:
    patch(client, jobs[1]["id"], owner_label=True)

    updated = patch(client, jobs[1]["id"], note="call back")

    assert updated["owner_label"] is True


# --- stats --------------------------------------------------------------------------------


def test_stats_count_tracker_activity_and_labels(
    client: TestClient, jobs: list[dict[str, Any]], migrated_engine: Engine
) -> None:
    patch(client, jobs[0]["id"], status="applied")
    patch(client, jobs[0]["id"], status="interview")
    patch(client, jobs[1]["id"], status="applied")
    patch(client, jobs[2]["id"], status="interview")
    patch(client, jobs[2]["id"], status="rejected")  # was an interview, still counts
    patch(client, jobs[3]["id"], owner_label=True)
    patch(client, jobs[4]["id"], owner_label=False)
    with Session(migrated_engine) as session:  # an application from last week
        long_ago = datetime.now(UTC) - timedelta(days=8)
        session.add(
            JobEvent(job_id=jobs[4]["id"], kind="status", value="applied", created_at=long_ago)
        )
        session.commit()

    assert client.get("/api/stats").json() == {
        "applied_this_week": 2,
        "interviews_total": 2,
        "new_matches": 1,  # jobs[3], moved to matches by the owner
        "new_not_matched": 1,  # jobs[4]
        "new_undecided": 0,
        "new_filtered": 0,
        "saved": 0,
        "labelled": 2,
        "labelled_relevant": 1,
        "labelled_not_relevant": 1,
    }


def test_week_starts_monday_midnight_utc() -> None:
    wednesday = datetime(2026, 10, 14, 15, 30, tzinfo=UTC)

    assert week_start(wednesday) == datetime(2026, 10, 12, tzinfo=UTC)
    assert week_start(datetime(2026, 10, 12, 0, 0, tzinfo=UTC)) == datetime(
        2026, 10, 12, tzinfo=UTC
    )


def test_stats_count_what_waits_in_each_view(
    client: TestClient, fetcher: FakeFetcher, llm: FakeLLM
) -> None:
    first = fetcher.items["stepstone"][0]
    fetcher.items["stepstone"][0] = {**first, "title": "Werkstudent Softwareentwicklung"}
    llm.answers = ["not json", "not json", YES, NO, NO]  # undecided, match, 2 x no match
    start_run_and_wait(client, {"stepstone": 5})
    match = ids(client, decision="match")[0]

    before = client.get("/api/stats").json()
    patch(client, match, status="saved")
    after = client.get("/api/stats").json()

    counts = ("new_matches", "new_not_matched", "new_undecided", "new_filtered", "saved")
    assert [before[key] for key in counts] == [1, 2, 1, 1, 0]
    assert [after[key] for key in counts] == [0, 2, 1, 1, 1]


def test_a_single_job_can_be_read(client: TestClient, jobs: list[dict[str, Any]]) -> None:
    assert client.get(f"/api/jobs/{jobs[0]['id']}").json() == jobs[0]
    assert client.get("/api/jobs/999").status_code == 404
