import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlmodel import Session, select

from shortlist import evaluation
from shortlist.config import REPO_ROOT
from shortlist.evaluation import (
    EvalResult,
    cost_report,
    evaluate,
    load_results,
    owner_label,
    percentile,
    replace_table,
    result_path,
    results_table,
    summarize,
    write_result,
)
from shortlist.llm.ollama_client import LLMUnavailable
from shortlist.llm.prompts import PROMPT_MAIN
from shortlist.models import Job, MatchDecision
from shortlist.pipeline.match import MatchResult
from tests.conftest import NO, YES, FakeLLM, start_run_and_wait

PROFILE = "- .NET developer"


def job(**fields: Any) -> Job:
    defaults: dict[str, Any] = {
        "fingerprint": "x",
        "title": "Developer",
        "company": "Beispiel GmbH",
        "description": "",
        "first_seen_run_id": 1,
        "first_seen_at": datetime(2026, 10, 13, tzinfo=UTC),
    }
    return Job(**{**defaults, **fields})


def result(match: bool | None, latency_ms: int = 1000) -> MatchResult:
    return MatchResult(match, "reason", latency_ms)


# --- labels -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fields", "label"),
    [
        ({"owner_label": True}, True),
        ({"owner_label": False}, False),
        ({"owner_label": False, "status": "applied"}, False),  # the explicit verdict wins
        ({"status": "saved"}, True),
        ({"status": "applied"}, True),
        ({"status": "interview"}, True),
        ({"status": "rejected"}, True),  # rejected by the employer: the owner did apply
        ({"status": "ignored"}, False),
        ({"status": "new"}, None),
    ],
)
def test_owner_label_from_verdict_or_status(fields: dict[str, Any], label: bool | None) -> None:
    assert owner_label(job(**fields)) is label


# --- metrics ------------------------------------------------------------------------------


def test_summarize_counts_agreement_with_the_owner() -> None:
    outcomes = [
        (True, result(True, 1000)),  # true positive
        (True, result(True, 1200)),  # true positive
        (True, result(False, 1400)),  # false negative
        (False, result(True, 1600)),  # false positive
        (False, result(False, 1800)),  # true negative
        (True, result(None, 2000)),  # undecided: wrong, and counts as not matched
        (None, result(True, 9000)),  # unlabelled: speed and validity only
    ]

    metrics = summarize(outcomes)

    assert metrics == {
        "jobs": 7,
        "json_validity_rate": pytest.approx(6 / 7),
        "latency_median_ms": 1600,
        "latency_p95_ms": 9000,
        "labelled": 6,
        "labelled_relevant": 4,
        "accuracy": pytest.approx(3 / 6),
        "precision": pytest.approx(2 / 3),
        "recall": pytest.approx(2 / 4),
        "true_positives": 2,
        "false_positives": 1,
        "true_negatives": 1,
        "false_negatives": 2,
    }


def test_summarize_without_labels_has_no_accuracy() -> None:
    metrics = summarize([(None, result(True)), (None, result(False))])

    assert (metrics["labelled"], metrics["accuracy"], metrics["precision"], metrics["recall"]) == (
        0,
        None,
        None,
        None,
    )
    assert metrics["json_validity_rate"] == 1


def test_percentile_is_nearest_rank() -> None:
    values = list(range(1, 21))  # 1..20

    assert percentile(values, 95) == 19
    assert percentile(values, 50) == 10
    assert percentile([7], 95) == 7
    assert percentile([], 95) is None


# --- evaluate -----------------------------------------------------------------------------


@pytest.fixture
def labelled(client: TestClient, llm: FakeLLM, migrated_engine: Engine) -> Engine:
    """Five StepStone jobs: two judged relevant, one not relevant, two without a label."""
    start_run_and_wait(client, {"stepstone": 5})
    ids = [j["id"] for j in client.get("/api/jobs").json()]
    client.patch(f"/api/jobs/{ids[0]}", json={"owner_label": True})
    client.patch(f"/api/jobs/{ids[1]}", json={"status": "applied"})
    client.patch(f"/api/jobs/{ids[2]}", json={"status": "ignored"})
    llm.calls.clear()
    return migrated_engine


def run_eval(engine: Engine, llm: FakeLLM, **options: Any) -> EvalResult:
    return asyncio.run(evaluate(engine, llm, "test-model", PROMPT_MAIN, PROFILE, **options))


def test_evaluate_runs_only_labelled_jobs_and_scores_them(labelled: Engine, llm: FakeLLM) -> None:
    llm.respond = lambda prompt: YES  # says yes to everything

    outcome = run_eval(labelled, llm)

    assert (outcome.model, outcome.prompt_version) == ("test-model", "v2")
    assert (outcome.jobs, outcome.labelled, outcome.labelled_relevant) == (3, 3, 2)
    assert outcome.accuracy == pytest.approx(2 / 3)
    assert outcome.precision == pytest.approx(2 / 3)
    assert outcome.recall == 1
    assert outcome.json_validity_rate == 1
    assert (outcome.gpu_percent, outcome.context_length) == (100, 8192)
    assert len(llm.calls) == 4  # 3 jobs + 1 warm-up that is not measured
    assert all(call["user"].startswith(f"CANDIDATE PROFILE\n{PROFILE}") for call in llm.calls)


def test_evaluate_all_adds_unlabelled_jobs_for_speed_only(labelled: Engine, llm: FakeLLM) -> None:
    outcome = run_eval(labelled, llm, include_unlabelled=True)

    assert (outcome.jobs, outcome.labelled) == (5, 3)


def test_invalid_output_lowers_validity_and_counts_as_wrong(labelled: Engine, llm: FakeLLM) -> None:
    llm.answers = [YES, "not json", "not json"]  # warm-up, then the first job fails twice

    outcome = run_eval(labelled, llm)

    assert outcome.json_validity_rate == pytest.approx(2 / 3)
    assert outcome.false_negatives == 1


def test_evaluate_does_not_touch_stored_decisions(labelled: Engine, llm: FakeLLM) -> None:
    def decisions() -> list[tuple[int | None, bool | None]]:
        with Session(labelled) as session:
            return [(d.id, d.match) for d in session.exec(select(MatchDecision)).all()]

    before = decisions()
    llm.respond = lambda prompt: NO

    run_eval(labelled, llm)

    assert decisions() == before


def test_evaluate_needs_labels_unless_all(
    client: TestClient, llm: FakeLLM, migrated_engine: Engine
) -> None:
    start_run_and_wait(client, {"stepstone": 5})

    with pytest.raises(ValueError, match="No labelled jobs"):
        run_eval(migrated_engine, llm)
    assert run_eval(migrated_engine, llm, include_unlabelled=True).accuracy is None


def test_evaluate_stops_when_the_model_is_unavailable(labelled: Engine, llm: FakeLLM) -> None:
    llm.unavailable = LLMUnavailable('Model "x:1b" is not installed. Run: ollama pull x:1b')

    with pytest.raises(LLMUnavailable, match="ollama pull"):
        run_eval(labelled, llm)


def test_per_job_details_go_to_the_uncommitted_directory(
    labelled: Engine, llm: FakeLLM, tmp_path: Path
) -> None:
    run_eval(labelled, llm, details_dir=tmp_path)

    (details,) = tmp_path.glob("*.json")
    assert details.name == "test-model.json"
    assert '"title": "Softwareentwickler (m/w/d)"' in details.read_text()


# --- result files and the README table ----------------------------------------------------


def eval_result(**fields: Any) -> EvalResult:
    defaults: dict[str, Any] = {
        "model": "qwen3.5:9b",
        "prompt_version": "v2",
        "created_at": datetime(2026, 10, 13, tzinfo=UTC),
        "gpu": "NVIDIA GeForce RTX 4060 Laptop GPU",
        "gpu_percent": 100,
        "context_length": 8192,
        "jobs": 60,
        "json_validity_rate": 1.0,
        "latency_median_ms": 1740.0,
        "latency_p95_ms": 2300.0,
        "labelled": 50,
        "labelled_relevant": 20,
        "accuracy": 0.84,
        "precision": 0.8,
        "recall": 0.75,
        "true_positives": 15,
        "false_positives": 4,
        "true_negatives": 27,
        "false_negatives": 4,
    }
    return EvalResult(**{**defaults, **fields})


def test_result_file_names() -> None:
    directory = Path("/results")

    assert result_path("qwen3.5:9b", "v2", directory) == directory / "qwen3.5_9b.json"
    assert result_path("gemma4:12b-it-qat", "v3-checklist", directory) == (
        directory / "gemma4_12b-it-qat__v3-checklist.json"
    )
    assert result_path("../../etc/x", "v2", directory).parent == directory


def test_results_round_trip_and_ignore_the_cost_file(tmp_path: Path) -> None:
    write_result(eval_result(), tmp_path)
    write_result(eval_result(model="gemma4:12b-it-qat", accuracy=None), tmp_path)
    (tmp_path / evaluation.COSTS_FILE).write_text("{}")

    loaded = load_results(tmp_path)

    assert [r.model for r in loaded] == ["gemma4:12b-it-qat", "qwen3.5:9b"]
    assert loaded[1] == eval_result()


def test_results_table() -> None:
    table = results_table(
        [
            eval_result(),
            eval_result(
                model="gemma4:12b-it-qat",
                labelled=0,
                accuracy=None,
                precision=None,
                recall=None,
                gpu_percent=87,
                latency_median_ms=3552.0,
                latency_p95_ms=4787.0,
            ),
        ]
    )

    rows = table.splitlines()
    assert rows[2] == "| `qwen3.5:9b` | v2 | 50 | 84% | 80% | 75% | 100% | 1.7 s | 2.3 s | 100% |"
    assert rows[3] == (
        "| `gemma4:12b-it-qat` | v2 | 0 | n/a | n/a | n/a | 100% | 3.6 s | 4.8 s | 87% |"
    )
    assert "GPU: NVIDIA GeForce RTX 4060 Laptop GPU." in rows[-1]
    assert results_table([]).startswith("_No evaluation results yet")


def test_replace_table_keeps_the_rest_of_the_document() -> None:
    document = "# Title\n\n<!-- eval:start -->\nold\n<!-- eval:end -->\n\nMore text.\n"

    updated = replace_table(document, "| new |")

    assert updated == "# Title\n\n<!-- eval:start -->\n| new |\n<!-- eval:end -->\n\nMore text.\n"
    assert replace_table(updated, "| new |") == updated


def test_readme_table_matches_the_committed_results() -> None:
    """The README must show exactly what eval/results/ contains (run `make eval-table`)."""
    readme = (REPO_ROOT / "README.md").read_text()

    assert replace_table(readme, results_table(load_results())) == readme


# --- costs --------------------------------------------------------------------------------


def test_cost_report_sums_runs_per_month(client: TestClient, migrated_engine: Engine) -> None:
    start_run_and_wait(client, {"stepstone": 5})
    start_run_and_wait(client, {"indeed": 3})

    report = cost_report(migrated_engine)

    (month,) = report.months
    assert month.month == datetime.now(UTC).strftime("%Y-%m")
    assert (month.runs, month.results_fetched) == (2, 8)
    assert month.estimated_cost_usd == pytest.approx(0.02 + 3 * 0.0001 + 3 * 0.001)
    assert "outside the app are not included" in report.note
