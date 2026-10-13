from typing import Any

import pytest
from fastapi.testclient import TestClient

from shortlist.api import settings as settings_api
from shortlist.config import AppConfig
from tests.conftest import FakeFetcher, FakeLLM, start_run_and_wait


def current(client: TestClient) -> dict[str, Any]:
    body: dict[str, Any] = client.get("/api/settings").json()
    return body


def editable(settings: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in settings.items() if k not in ("ollama_url", "apify_token_configured")}


def test_defaults(client: TestClient) -> None:
    settings = current(client)

    assert settings["full_name"] == ""
    assert "Background in manufacturing software" in settings["profile_text"]
    assert set(settings["searches"]) == {"linkedin", "indeed", "stepstone"}
    assert settings["default_limits"] == {"linkedin": 5, "indeed": 5, "stepstone": 5}
    assert settings["exclude_terms"] == ["Werkstudent", "Praktikum", "Ausbildung", "Duales Studium"]
    assert settings["monthly_budget_usd"] == 10
    assert settings["prices"]["stepstone"] == {"per_1000_results": 1.0, "per_start": 0.005}
    assert settings["model_name"] == "gemma4:12b-it-qat"
    assert settings["ollama_url"].startswith("http")


def test_token_status_is_shown_but_never_the_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret = "apify_api_SECRET"
    monkeypatch.setattr(
        settings_api, "get_config", lambda: AppConfig(_env_file=None, apify_token=secret)
    )
    response = client.get("/api/settings")
    assert response.json()["apify_token_configured"] is True
    assert secret not in response.text

    monkeypatch.setattr(
        settings_api, "get_config", lambda: AppConfig(_env_file=None, apify_token=None)
    )
    assert client.get("/api/settings").json()["apify_token_configured"] is False


def test_everything_editable_is_saved(client: TestClient) -> None:
    update: dict[str, Any] = {
        "full_name": "Ada Lovelace",
        "profile_text": "- Python developer",
        "searches": {
            "linkedin": [
                {"keyword": "python developer", "location": "Berlin", "posted_within_days": 7}
            ],
            "indeed": [],
            "stepstone": [{"keyword": "  python  ", "location": None, "posted_within_days": None}],
        },
        "default_limits": {"linkedin": 20, "indeed": 30, "stepstone": 10},
        "exclude_terms": ["Senior", " Lead ", "Senior"],
        "monthly_budget_usd": 3.5,
        "prices": {
            "linkedin": {"per_1000_results": 1.0, "per_start": 0},
            "indeed": {"per_1000_results": 0.1, "per_start": 0.001},
            "stepstone": {"per_1000_results": 2.0, "per_start": 0.01},
        },
        "model_name": "gemma4:e4b",
    }

    saved = client.put("/api/settings", json=update)

    assert saved.status_code == 200
    expected = {
        **update,
        "exclude_terms": ["Senior", "Lead"],  # trimmed, duplicates removed
        "searches": {
            **update["searches"],
            "stepstone": [{"keyword": "python", "location": None, "posted_within_days": None}],
        },
    }
    assert editable(saved.json()) == expected
    assert editable(current(client)) == expected


@pytest.mark.parametrize(
    "change",
    [
        {"profile_text": ""},
        {"full_name": "x" * 101},
        {"monthly_budget_usd": -1},
        {"model_name": "two words"},
        {"exclude_terms": [""]},
        {"default_limits": {"linkedin": 0, "indeed": 5, "stepstone": 5}},
        {"default_limits": {"linkedin": 1001, "indeed": 5, "stepstone": 5}},
        {"searches": {"linkedin": [{"keyword": " "}], "indeed": [], "stepstone": []}},
        {"searches": {"xing": [], "linkedin": [], "indeed": [], "stepstone": []}},
        {"prices": {"linkedin": {"per_1000_results": -1, "per_start": 0}}},
    ],
)
def test_invalid_settings_are_rejected_and_nothing_changes(
    client: TestClient, change: dict[str, Any]
) -> None:
    before = current(client)

    response = client.put("/api/settings", json={**editable(before), **change})

    assert response.status_code == 422
    assert current(client) == before


def test_every_source_must_be_present(client: TestClient) -> None:
    settings = editable(current(client))
    del settings["searches"]["indeed"]

    response = client.put("/api/settings", json=settings)

    assert response.status_code == 400
    assert "indeed" in response.json()["detail"]


def test_saved_settings_drive_the_next_run(
    client: TestClient, fetcher: FakeFetcher, llm: FakeLLM
) -> None:
    settings = editable(current(client))
    settings["profile_text"] = "- Rust developer"
    settings["searches"]["stepstone"] = [
        {"keyword": "rust", "location": "berlin", "posted_within_days": 3}
    ]
    settings["exclude_terms"] = ["Oracle"]
    settings["prices"]["stepstone"] = {"per_1000_results": 10.0, "per_start": 0.5}
    settings["default_limits"]["stepstone"] = 40
    client.put("/api/settings", json=settings)

    estimate = client.post("/api/runs/estimate", json={"limits": {"stepstone": 5}}).json()
    run = start_run_and_wait(client, {"stepstone": 5})

    assert estimate["max_cost_usd"] == pytest.approx(5 * 0.01 + 0.5)  # one search, new prices
    (call,) = fetcher.calls
    assert (call["run_input"]["keyword"], call["run_input"]["postedWithin"]) == ("rust", "3")
    assert run["estimated_cost_usd"] == pytest.approx(0.55)
    assert run["prefiltered_out"] == 1  # "Softwareentwickler (m/w/d) Oracle"
    assert all("- Rust developer" in c["user"] for c in llm.calls)
    sources = {s["name"]: s for s in client.get("/api/sources").json()}
    assert sources["stepstone"]["default_limit"] == 40
    assert sources["stepstone"]["searches"][0]["keyword"] == "rust"
