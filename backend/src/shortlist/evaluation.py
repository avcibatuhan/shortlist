"""Model evaluation (spec §9): run the match decision on the jobs the owner has judged and
compare. The numbers in the README come from the files this module writes."""

import json
import re
import statistics
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel
from sqlalchemy import Engine
from sqlmodel import Session, col, select

from shortlist.config import DATA_DIR, REPO_ROOT
from shortlist.llm.ollama_client import LLMClient, LLMUnavailable
from shortlist.llm.prompts import ACTIVE_PROMPT, Prompt
from shortlist.models import Job, Run
from shortlist.pipeline.match import MatchResult, decide, job_text

RESULTS_DIR = REPO_ROOT / "eval" / "results"
DETAILS_DIR = DATA_DIR / "eval"  # per-job output; real job data, never committed

# Statuses that say what the owner thinks of a job, when there is no explicit verdict.
RELEVANT_STATUSES = frozenset({"saved", "applied", "interview", "rejected"})
NOT_RELEVANT_STATUSES = frozenset({"ignored"})

COSTS_FILE = "apify_costs.json"  # lives next to the model results
TABLE_START, TABLE_END = "<!-- eval:start -->", "<!-- eval:end -->"


class EvalResult(BaseModel):
    """Aggregates only: safe to commit."""

    model: str
    prompt_version: str
    created_at: datetime
    gpu: str | None
    gpu_percent: int | None  # share of the model on the GPU while it ran
    context_length: int | None
    # Speed and output validity, over all evaluated jobs
    jobs: int
    json_validity_rate: float | None  # valid decisions / jobs
    latency_median_ms: float | None
    latency_p95_ms: float | None
    # Agreement with the owner, over the labelled jobs only. An undecided job counts as a
    # wrong answer and as "not matched".
    labelled: int
    labelled_relevant: int
    accuracy: float | None
    precision: float | None
    recall: float | None
    true_positives: int
    false_positives: int
    true_negatives: int
    false_negatives: int


def owner_label(job: Job) -> bool | None:
    """What the owner thinks: the explicit verdict, else what the status implies, else None."""
    if job.owner_label is not None:
        return job.owner_label
    if job.status in RELEVANT_STATUSES:
        return True
    if job.status in NOT_RELEVANT_STATUSES:
        return False
    return None


def ratio(part: int, whole: int) -> float | None:
    return part / whole if whole else None


def percentile(values: list[int], percent: float) -> float | None:
    """Nearest-rank percentile."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * percent // 100))  # ceiling
    return float(ordered[int(rank) - 1])


def summarize(
    outcomes: list[tuple[bool | None, MatchResult]],
) -> dict[str, float | int | None]:
    """Metrics from (owner label or None, model result) pairs."""
    labelled = [(label, result.match) for label, result in outcomes if label is not None]
    tp = sum(label and predicted is True for label, predicted in labelled)
    fp = sum(not label and predicted is True for label, predicted in labelled)
    tn = sum(not label and predicted is not True for label, predicted in labelled)
    fn = sum(label and predicted is not True for label, predicted in labelled)
    correct = sum(predicted is not None and predicted == label for label, predicted in labelled)
    latencies = [result.latency_ms for _, result in outcomes]
    return {
        "jobs": len(outcomes),
        "json_validity_rate": ratio(
            sum(result.match is not None for _, result in outcomes), len(outcomes)
        ),
        "latency_median_ms": statistics.median(latencies) if latencies else None,
        "latency_p95_ms": percentile(latencies, 95),
        "labelled": len(labelled),
        "labelled_relevant": tp + fn,
        "accuracy": ratio(correct, len(labelled)),
        "precision": ratio(tp, tp + fp),
        "recall": ratio(tp, tp + fn),
        "true_positives": tp,
        "false_positives": fp,
        "true_negatives": tn,
        "false_negatives": fn,
    }


def jobs_to_evaluate(session: Session, include_unlabelled: bool) -> list[Job]:
    jobs = session.exec(select(Job).order_by(col(Job.id))).all()
    return [job for job in jobs if include_unlabelled or owner_label(job) is not None]


def gpu_name() -> str | None:
    try:
        output = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return output.strip().splitlines()[0] if output.strip() else None


def result_path(model: str, prompt_version: str, directory: Path = RESULTS_DIR) -> Path:
    # The prompt the app uses needs no suffix; experimental prompts are named.
    is_default = prompt_version == ACTIVE_PROMPT.version
    name = model if is_default else f"{model}__{prompt_version}"
    return directory / f"{re.sub(r'[^A-Za-z0-9._-]+', '_', name)}.json"


async def evaluate(
    engine: Engine,
    llm: LLMClient,
    model: str,
    prompt: Prompt,
    profile: str,
    *,
    include_unlabelled: bool = False,
    details_dir: Path | None = None,
) -> EvalResult:
    """Decide every evaluated job once with `model` and `prompt`; nothing is stored in the
    database. Raises LLMUnavailable when the model cannot be used."""
    with Session(engine) as session:
        jobs = [
            (job.id, job.title, owner_label(job), job_text(job))
            for job in jobs_to_evaluate(session, include_unlabelled)
        ]
    if not jobs:
        raise ValueError(
            "No labelled jobs. Label jobs in the dashboard (Inbox > Label mode), "
            "or pass --all to measure speed and output validity only."
        )

    # Warm-up: loading the model into VRAM must not count as latency of the first job.
    warm_up = await decide(llm, model, profile, jobs[0][3], prompt)
    if warm_up.unavailable:
        raise LLMUnavailable(warm_up.reason)

    outcomes: list[tuple[bool | None, MatchResult]] = []
    details = []
    for job_id, title, label, text in jobs:
        result = await decide(llm, model, profile, text, prompt)
        if result.unavailable:
            raise LLMUnavailable(result.reason)
        outcomes.append((label, result))
        details.append(
            {
                "job_id": job_id,
                "title": title,
                "label": label,
                "match": result.match,
                "reason": result.reason,
                "latency_ms": result.latency_ms,
            }
        )

    placement = await llm.model_status(model)
    evaluation = EvalResult.model_validate(
        {
            "model": model,
            "prompt_version": prompt.version,
            "created_at": datetime.now(UTC),
            "gpu": gpu_name(),
            "gpu_percent": placement.gpu_percent if placement else None,
            "context_length": placement.context_length if placement else None,
            **summarize(outcomes),
        }
    )
    if details_dir is not None:
        details_dir.mkdir(parents=True, exist_ok=True)
        result_path(model, prompt.version, details_dir).write_text(
            json.dumps(details, ensure_ascii=False, indent=1)
        )
    return evaluation


def write_result(evaluation: EvalResult, directory: Path = RESULTS_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = result_path(evaluation.model, evaluation.prompt_version, directory)
    path.write_text(evaluation.model_dump_json(indent=2) + "\n")
    return path


def load_results(directory: Path = RESULTS_DIR) -> list[EvalResult]:
    files = sorted(p for p in directory.glob("*.json") if p.name != COSTS_FILE)
    return [EvalResult.model_validate_json(path.read_text()) for path in files]


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.0f}%"


def _seconds(ms: float | None) -> str:
    return "n/a" if ms is None else f"{ms / 1000:.1f} s"


def results_table(results: list[EvalResult]) -> str:
    """Markdown comparison table for the README, from the committed result files."""
    if not results:
        return "_No evaluation results yet. Run `make eval`._"
    lines = [
        "| Model | Prompt | Labelled jobs | Accuracy | Precision | Recall | Valid JSON "
        "| Median / job | p95 / job | On GPU |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        on_gpu = "n/a" if r.gpu_percent is None else f"{r.gpu_percent}%"
        lines.append(
            f"| `{r.model}` | {r.prompt_version} | {r.labelled} | {_percent(r.accuracy)} "
            f"| {_percent(r.precision)} | {_percent(r.recall)} | {_percent(r.json_validity_rate)} "
            f"| {_seconds(r.latency_median_ms)} | {_seconds(r.latency_p95_ms)} | {on_gpu} |"
        )
    gpus = sorted({r.gpu for r in results if r.gpu})
    jobs = sorted({r.jobs for r in results})
    lines.append("")
    lines.append(
        f"GPU: {', '.join(gpus) or 'unknown'}. Speed and valid-JSON rate over "
        f"{' / '.join(str(n) for n in jobs)} jobs; accuracy, precision and recall over the "
        "labelled jobs only (n/a = no labelled jobs yet)."
    )
    return "\n".join(lines)


def replace_table(document: str, table: str) -> str:
    """`document` with the block between the eval markers replaced by `table`."""
    start, end = document.index(TABLE_START), document.index(TABLE_END)
    return f"{document[: start + len(TABLE_START)]}\n{table}\n{document[end:]}"


# --- Apify cost from the run history -------------------------------------------------------


class MonthCosts(BaseModel):
    month: str  # YYYY-MM (UTC)
    runs: int
    results_fetched: int
    estimated_cost_usd: float


class CostReport(BaseModel):
    created_at: datetime
    note: str
    months: list[MonthCosts]


def cost_report(engine: Engine) -> CostReport:
    """The app's own cost estimates per month, from the stored runs."""
    months: dict[str, MonthCosts] = {}
    with Session(engine) as session:
        for run in session.exec(select(Run).order_by(col(Run.id))).all():
            key = run.started_at.astimezone(UTC).strftime("%Y-%m")
            month = months.setdefault(
                key, MonthCosts(month=key, runs=0, results_fetched=0, estimated_cost_usd=0.0)
            )
            month.runs += 1
            month.results_fetched += run.fetched
            month.estimated_cost_usd = round(month.estimated_cost_usd + run.estimated_cost_usd, 5)
    return CostReport(
        created_at=datetime.now(UTC),
        note=(
            "Estimated by the app from results fetched and Actor starts, at the prices in "
            "Settings. Runs started outside the app are not included."
        ),
        months=list(months.values()),
    )
