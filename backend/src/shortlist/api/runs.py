import asyncio
import json
from collections.abc import AsyncIterable
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.sse import EventSourceResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, col, func, select

from shortlist.config import get_config
from shortlist.db import EngineDep, SessionDep
from shortlist.events import ProgressBus, RunProgress, SourceProgress
from shortlist.models import Run
from shortlist.owner_settings import get_settings, prices_for, searches_for
from shortlist.pipeline.fetch import ApifyFetcher, Fetcher
from shortlist.pipeline.run import RunDeps, SourceStats, execute_run
from shortlist.prices import max_cost_usd
from shortlist.sources import SOURCES

router = APIRouter(prefix="/runs", tags=["runs"])

RunState = Literal["running", "done", "failed", "partial"]
# Result limit per source. A run without explicit limits is not possible.
Limits = Annotated[dict[str, Annotated[int, Field(ge=1, le=1000)]], Field(min_length=1)]


class RunCreate(BaseModel):
    limits: Limits
    # Required when the run could take this month's cost over the monthly budget.
    confirm_over_budget: bool = False


class EstimateRequest(BaseModel):
    limits: Limits


class EstimateOut(BaseModel):
    sources: dict[str, float]  # maximum cost per source in USD
    max_cost_usd: float
    month_spent_usd: float
    monthly_budget_usd: float
    exceeds_budget: bool


class MonthCost(BaseModel):
    month: str  # YYYY-MM (UTC)
    runs: int
    cost_usd: float


class RunOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime | None
    state: RunState
    limits: dict[str, int]
    # fetched = skipped + duplicates_in_run + already_known + new
    fetched: int
    skipped: int
    duplicates_in_run: int
    already_known: int
    new: int
    prefiltered_out: int
    matched: int
    not_matched: int
    undecided: int
    estimated_cost_usd: float
    sources: dict[str, SourceStats]
    errors: dict[str, str]


def run_out(run: Run) -> RunOut:
    return RunOut(
        id=run.id or 0,
        started_at=run.started_at,
        finished_at=run.finished_at,
        state=run.state,
        limits=json.loads(run.limits_json),
        fetched=run.fetched,
        skipped=run.skipped,
        duplicates_in_run=run.fetched - run.skipped - run.unique,
        already_known=run.unique - run.new,
        new=run.new,
        prefiltered_out=run.prefiltered_out,
        matched=run.matched,
        not_matched=run.not_matched,
        undecided=run.undecided,
        estimated_cost_usd=run.estimated_cost_usd,
        sources=json.loads(run.sources_json),
        errors=json.loads(run.errors_json),
    )


def get_fetcher(request: Request) -> Fetcher:
    fetcher: Fetcher | None = request.app.state.fetcher
    if fetcher is not None:
        return fetcher
    token = get_config().apify_token
    if not token:
        raise HTTPException(400, "APIFY_TOKEN is missing. Add it to .env and restart the backend.")
    return ApifyFetcher(token)


def get_bus(request: Request) -> ProgressBus:
    bus: ProgressBus = request.app.state.progress_bus
    return bus


BusDep = Annotated[ProgressBus, Depends(get_bus)]


def check_sources(limits: dict[str, int]) -> None:
    unknown = sorted(set(limits) - set(SOURCES))
    if unknown:
        raise HTTPException(400, f"Unknown source(s): {', '.join(unknown)}")


def month_start(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def estimate(session: Session, limits: dict[str, int]) -> EstimateOut:
    """Maximum cost of a run with these limits, next to this month's cost and the budget."""
    settings = get_settings(session)
    prices = prices_for(settings)
    sources = {
        name: max_cost_usd(prices[name], limit, len(searches_for(settings, name)))
        for name, limit in limits.items()
    }
    spent = session.exec(
        select(func.coalesce(func.sum(Run.estimated_cost_usd), 0.0)).where(
            Run.started_at >= month_start(datetime.now(UTC))
        )
    ).one()
    total = sum(sources.values())
    return EstimateOut(
        sources=sources,
        max_cost_usd=total,
        month_spent_usd=spent,
        monthly_budget_usd=settings.monthly_budget_usd,
        exceeds_budget=spent + total > settings.monthly_budget_usd,
    )


@router.post("/estimate", responses={400: {}})
def estimate_run(body: EstimateRequest, session: SessionDep) -> EstimateOut:
    check_sources(body.limits)
    return estimate(session, body.limits)


@router.post("", status_code=202, responses={400: {}, 409: {}})
async def start_run(
    body: RunCreate,
    request: Request,
    session: SessionDep,
    engine: EngineDep,
    bus: BusDep,
    fetcher: Annotated[Fetcher, Depends(get_fetcher)],
) -> RunOut:
    """Start a run in the background. Only one run can be active at a time."""
    check_sources(body.limits)
    if session.exec(select(Run).where(Run.state == "running")).first() is not None:
        raise HTTPException(409, "A run is already active.")
    if request.app.state.match_activity.running:
        raise HTTPException(
            409, "Undecided jobs are being re-evaluated. Try again when it is done."
        )
    cost = estimate(session, body.limits)
    if cost.exceeds_budget and not body.confirm_over_budget:
        raise HTTPException(
            409,
            f"This run could cost up to ${cost.max_cost_usd:.2f}; with ${cost.month_spent_usd:.2f} "
            f"already spent this month that exceeds the ${cost.monthly_budget_usd:.2f} budget. "
            "Confirm to run anyway.",
        )

    run = Run(started_at=datetime.now(UTC), limits_json=json.dumps(body.limits))
    session.add(run)
    session.commit()
    session.refresh(run)
    assert run.id is not None

    bus.start(run.id, list(body.limits))
    state = request.app.state
    deps = RunDeps(
        engine=engine,
        fetcher=fetcher,
        llm=state.llm,
        raw_dir=state.raw_dir,
        bus=bus,
        retry_backoff_seconds=state.retry_backoff_seconds,
        llm_concurrency=state.llm_concurrency,
    )
    task = asyncio.create_task(execute_run(run.id, deps))
    # Keep a reference: the event loop only holds weak references to tasks.
    tasks: set[asyncio.Task[None]] = request.app.state.run_tasks
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return run_out(run)


@router.get("")
def list_runs(session: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> list[RunOut]:
    """Past runs, newest first."""
    runs = session.exec(select(Run).order_by(col(Run.id).desc()).limit(limit)).all()
    return [run_out(run) for run in runs]


@router.get("/costs")
def monthly_costs(session: SessionDep) -> list[MonthCost]:
    """Estimated Apify cost per calendar month (UTC), newest first."""
    months: dict[str, MonthCost] = {}
    for run in session.exec(select(Run).order_by(col(Run.id).desc())).all():
        key = run.started_at.astimezone(UTC).strftime("%Y-%m")
        month = months.setdefault(key, MonthCost(month=key, runs=0, cost_usd=0.0))
        month.runs += 1
        month.cost_usd += run.estimated_cost_usd
    return list(months.values())


@router.get("/{run_id}", responses={404: {}})
def get_run(run_id: int, session: SessionDep) -> RunOut:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run_out(run)


def finished_progress(run: RunOut) -> RunProgress:
    """Progress of a run that is no longer active, rebuilt from what was stored."""
    return RunProgress(
        run_id=run.id,
        stage="failed" if run.state == "failed" else "done",
        sources={
            name: SourceProgress(
                state="error" if name in run.errors and name not in run.sources else "done",
                fetched=run.sources[name].fetched if name in run.sources else 0,
                error=run.errors.get(name),
            )
            for name in run.limits
        },
        llm_done=run.matched + run.not_matched + run.undecided,
        llm_total=run.matched + run.not_matched + run.undecided,
    )


def stored_run(run_id: int, engine: EngineDep) -> RunOut:
    """The run as stored, or 404. Uses its own short session: the event stream would
    otherwise keep a request-scoped one open for as long as it runs."""
    with Session(engine) as session:
        run = session.get(Run, run_id)
        if run is None:
            raise HTTPException(404, "Run not found")
        return run_out(run)


@router.get("/{run_id}/events", response_class=EventSourceResponse, responses={404: {}})
async def run_events(
    run_id: int, stored: Annotated[RunOut, Depends(stored_run)], engine: EngineDep, bus: BusDep
) -> AsyncIterable[RunProgress]:
    """Server-Sent Events: the run's progress on every change, ending with a final stage."""
    sent_final = False
    async for progress in bus.subscribe(run_id):
        yield progress
        sent_final = progress.stage in ("done", "failed")
    if not sent_final:
        # Not active (any more): finished earlier, or between the lookup and subscribing.
        yield finished_progress(stored_run(run_id, engine))
