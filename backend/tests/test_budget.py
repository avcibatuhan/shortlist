from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlmodel import Session

from shortlist.models import Run
from shortlist.owner_settings import get_settings
from tests.conftest import start_run_and_wait


def add_past_run(engine: Engine, started_at: datetime, cost: float) -> None:
    with Session(engine) as session:
        session.add(Run(started_at=started_at, state="done", estimated_cost_usd=cost))
        session.commit()


def test_estimate_is_limit_times_price_plus_one_start_per_search(client: TestClient) -> None:
    body = client.post(
        "/api/runs/estimate", json={"limits": {"linkedin": 50, "indeed": 50, "stepstone": 50}}
    ).json()

    assert body["sources"] == {
        "linkedin": pytest.approx(50 * 0.002 + 3 * 0.00005),
        "indeed": pytest.approx(50 * 0.0001 + 3 * 0.001),
        "stepstone": pytest.approx(50 * 0.001 + 3 * 0.005),
    }
    assert body["max_cost_usd"] == pytest.approx(sum(body["sources"].values()))
    assert body["month_spent_usd"] == 0
    assert body["monthly_budget_usd"] == 10
    assert body["exceeds_budget"] is False


def test_estimate_rejects_unknown_sources_and_missing_limits(client: TestClient) -> None:
    assert client.post("/api/runs/estimate", json={"limits": {"xing": 5}}).status_code == 400
    assert client.post("/api/runs/estimate", json={"limits": {}}).status_code == 422


def test_month_spent_counts_this_months_runs_only(
    client: TestClient, migrated_engine: Engine
) -> None:
    now = datetime.now(UTC)
    add_past_run(migrated_engine, now, 1.25)
    add_past_run(migrated_engine, now.replace(year=now.year - 1), 4.0)

    body = client.post("/api/runs/estimate", json={"limits": {"stepstone": 5}}).json()

    assert body["month_spent_usd"] == pytest.approx(1.25)


def test_run_over_budget_is_blocked_until_confirmed(
    client: TestClient, migrated_engine: Engine
) -> None:
    add_past_run(migrated_engine, datetime.now(UTC), 9.99)

    estimate = client.post("/api/runs/estimate", json={"limits": {"stepstone": 5}}).json()
    blocked = client.post("/api/runs", json={"limits": {"stepstone": 5}})

    assert estimate["exceeds_budget"] is True
    assert blocked.status_code == 409
    assert "budget" in blocked.json()["detail"]
    assert len(client.get("/api/runs").json()) == 1  # nothing was started

    run = start_run_and_wait(client, {"stepstone": 5}, confirm_over_budget=True)
    assert run["state"] == "done"


def test_budget_comes_from_settings(client: TestClient, migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        settings = get_settings(session)
        settings.monthly_budget_usd = 0.01
        session.add(settings)
        session.commit()

    body = client.post("/api/runs/estimate", json={"limits": {"stepstone": 5}}).json()

    assert body["monthly_budget_usd"] == 0.01
    assert body["exceeds_budget"] is True


def test_monthly_costs_group_runs_by_month(client: TestClient, migrated_engine: Engine) -> None:
    add_past_run(migrated_engine, datetime(2026, 9, 30, 12, tzinfo=UTC), 0.5)
    add_past_run(migrated_engine, datetime(2026, 10, 1, 12, tzinfo=UTC), 0.02)
    add_past_run(migrated_engine, datetime(2026, 10, 13, 12, tzinfo=UTC), 0.03)

    assert client.get("/api/runs/costs").json() == [
        {"month": "2026-10", "runs": 2, "cost_usd": pytest.approx(0.05)},
        {"month": "2026-09", "runs": 1, "cost_usd": pytest.approx(0.5)},
    ]
