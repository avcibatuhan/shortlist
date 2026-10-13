"""Run pipeline: fetch -> normalize -> deduplicate -> prefilter -> save -> LLM match."""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from shortlist.events import ProgressBus
from shortlist.llm.ollama_client import LLMClient
from shortlist.models import Job, JobSource, Run
from shortlist.owner_settings import exclude_terms, get_settings, prices_for, searches_for
from shortlist.pipeline.dedup import fingerprint
from shortlist.pipeline.fetch import (
    Fetcher,
    delete_old_raw,
    fetch_with_retry,
    save_raw,
    split_limit,
)
from shortlist.pipeline.match import match_jobs
from shortlist.pipeline.prefilter import filter_reason
from shortlist.prices import SourcePrice
from shortlist.sources import SOURCES
from shortlist.sources.base import NormalizedJob, RawItem, Search, Source

logger = logging.getLogger(__name__)

INTERRUPTED = "Interrupted: the backend stopped during this run."

Outcome = Literal["new", "known", "duplicate"]


class SourceStats(BaseModel):
    """Counts for one source in one run: fetched = skipped + duplicates + known + new."""

    limit: int
    fetched: int = 0
    skipped: int = 0  # items without id, title or link
    duplicates: int = 0  # same job found earlier in this run (other search or other source)
    known: int = 0  # already in the database from an earlier run
    new: int = 0
    starts: int = 0  # Actor runs started (each may carry a start fee, even when it fails)
    cost_usd: float = 0.0


@dataclass
class SourceResult:
    stats: SourceStats
    items: list[RawItem] = field(default_factory=list)
    jobs: list[NormalizedJob] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    searches_ok: int = 0


@dataclass(frozen=True)
class RunDeps:
    """What a run needs from the app; tests inject fakes."""

    engine: Engine
    fetcher: Fetcher
    llm: LLMClient
    raw_dir: Path
    bus: ProgressBus
    retry_backoff_seconds: float
    llm_concurrency: int


def job_fingerprint(job: NormalizedJob) -> str:
    if not job.company:
        # Anonymous ads: without a company, title + city would merge unrelated jobs.
        return fingerprint(f"{job.source} {job.source_job_id}", job.title, job.location)
    return fingerprint(job.company, job.title, job.location)


async def fetch_source(
    source: Source,
    searches: list[Search],
    limit: int,
    fetcher: Fetcher,
    price: SourcePrice,
    retry_backoff_seconds: float,
) -> SourceResult:
    """Run the searches one after another, each with its share of the limit.

    What a search leaves unused (few results, or it failed) is passed on to the next search,
    so the source limit is used where there are results. One failing search does not stop
    the rest.
    """
    result = SourceResult(stats=SourceStats(limit=limit))
    stats = result.stats
    if not searches:
        result.errors.append("No searches configured for this source.")
        return result

    def count_start() -> None:
        stats.starts += 1

    unused = 0
    for search, share in zip(searches, split_limit(limit, len(searches)), strict=True):
        search_limit = share + unused
        if search_limit == 0:
            continue
        try:
            items = await fetch_with_retry(
                fetcher,
                source.actor_id,
                source.build_input(search, search_limit),
                search_limit,
                price.charge_cap_usd(search_limit),
                backoff_seconds=retry_backoff_seconds,
                on_attempt=count_start,
            )
        except Exception as exc:
            logger.exception("Fetch failed: %s %r", source.name, search.keyword)
            result.errors.append(f'"{search.keyword}": {type(exc).__name__}: {exc}')
            unused = search_limit
        else:
            items = items[:search_limit]
            result.items.extend(items)
            result.searches_ok += 1
            unused = search_limit - len(items)

    stats.fetched = len(result.items)
    stats.cost_usd = price.cost_usd(stats.fetched, stats.starts)
    return result


def normalize_source(source: Source, result: SourceResult) -> None:
    result.jobs = [job for item in result.items if (job := source.normalize(item)) is not None]
    result.stats.skipped = len(result.items) - len(result.jobs)
    if result.stats.skipped:
        result.errors.append(
            f"{result.stats.skipped} item(s) had no id, title or link and were skipped."
        )


async def run_source(
    run_id: int,
    source: Source,
    searches: list[Search],
    limit: int,
    fetcher: Fetcher,
    price: SourcePrice,
    raw_dir: Path,
    bus: ProgressBus,
    retry_backoff_seconds: float,
) -> SourceResult:
    """Fetch and normalize one source. Never raises: a broken source must not stop the others."""
    name = source.name
    bus.source(run_id, name, "fetching")
    try:
        result = await fetch_source(source, searches, limit, fetcher, price, retry_backoff_seconds)
        bus.source(run_id, name, "normalizing", fetched=result.stats.fetched)
        if result.items:
            save_raw(raw_dir, run_id, name, result.items)
        normalize_source(source, result)
    except Exception as exc:
        logger.exception("Source failed: %s", name)
        result = SourceResult(stats=SourceStats(limit=limit))
        result.errors.append(f"{type(exc).__name__}: {exc}")
    error = "; ".join(result.errors) or None
    bus.source(run_id, name, "done" if result.searches_ok else "error", error=error)
    return result


def store_job(
    session: Session, run_id: int, job: NormalizedJob, now: datetime
) -> tuple[Outcome, Job]:
    """Insert a job not seen before; for a known job only add a missing source link."""
    known_source = session.exec(
        select(JobSource).where(
            JobSource.source == job.source, JobSource.source_job_id == job.source_job_id
        )
    ).first()
    if known_source is not None:  # the same posting again
        existing = session.get(Job, known_source.job_id)
        assert existing is not None
        return ("duplicate" if existing.first_seen_run_id == run_id else "known"), existing

    fp = job_fingerprint(job)
    existing = session.exec(select(Job).where(Job.fingerprint == fp)).first()
    outcome: Outcome
    if existing is None:
        outcome = "new"
        existing = Job(
            fingerprint=fp,
            title=job.title,
            company=job.company,
            location=job.location,
            remote=job.remote,
            posted_at=job.posted_at,
            employment_type=job.employment_type,
            salary_text=job.salary_text,
            description=job.description,
            description_is_snippet=job.description_is_snippet,
            language=job.language,
            first_seen_run_id=run_id,
            first_seen_at=now,
        )
        session.add(existing)
        session.flush()
    else:
        outcome = "duplicate" if existing.first_seen_run_id == run_id else "known"
    assert existing.id is not None
    session.add(
        JobSource(
            job_id=existing.id, source=job.source, source_job_id=job.source_job_id, url=job.url
        )
    )
    session.flush()
    return outcome, existing


def store_results(
    session: Session,
    run_id: int,
    results: dict[str, SourceResult],
    terms: list[str],
    now: datetime,
) -> tuple[int, list[int]]:
    """Deduplicate and save all sources' jobs, updating their stats.

    Returns the number of prefiltered jobs and the ids of the new jobs left for the LLM.
    """
    prefiltered = 0
    to_match: list[int] = []
    for result in results.values():
        for job in result.jobs:
            outcome, stored = store_job(session, run_id, job, now)
            if outcome == "new":
                result.stats.new += 1
                stored.filter_reason = filter_reason(stored.title, terms)
                if stored.filter_reason is not None:
                    prefiltered += 1
                    session.add(stored)
                else:
                    assert stored.id is not None
                    to_match.append(stored.id)
            elif outcome == "known":
                result.stats.known += 1
            else:
                result.stats.duplicates += 1
    return prefiltered, to_match


def run_state(results: dict[str, SourceResult]) -> str:
    any_ok = any(r.searches_ok > 0 for r in results.values())
    any_error = any(r.errors for r in results.values())
    if not any_ok:
        return "failed"
    return "partial" if any_error else "done"


async def execute_run(run_id: int, deps: RunDeps) -> None:
    """Background task for one run. Always leaves the run in a final state."""
    try:
        await _execute(run_id, deps)
    except Exception as exc:
        logger.exception("Run %s failed", run_id)
        with Session(deps.engine) as session:
            run = session.get(Run, run_id)
            if run is not None:
                run.state = "failed"
                run.finished_at = datetime.now(UTC)
                run.errors_json = json.dumps({"run": f"{type(exc).__name__}: {exc}"})
                session.add(run)
                session.commit()
        deps.bus.stage(run_id, "failed")


async def _execute(run_id: int, deps: RunDeps) -> None:
    engine, bus = deps.engine, deps.bus
    delete_old_raw(deps.raw_dir)
    with Session(engine) as session:
        run = session.get(Run, run_id)
        if run is None:
            raise LookupError(f"Run {run_id} does not exist")
        limits: dict[str, int] = json.loads(run.limits_json)
        settings = get_settings(session)
        searches = {name: searches_for(settings, name) for name in limits}
        terms = exclude_terms(settings)
        profile, model = settings.profile_text, settings.model_name
        prices = prices_for(settings)

    # Sources run in parallel; the order of `limits` decides which source a shared job counts for.
    fetched = await asyncio.gather(
        *(
            run_source(
                run_id,
                SOURCES[name],
                searches[name],
                limit,
                deps.fetcher,
                prices[name],
                deps.raw_dir,
                bus,
                deps.retry_backoff_seconds,
            )
            for name, limit in limits.items()
        )
    )
    results = dict(zip(limits, fetched, strict=True))

    # Jobs are saved before the LLM runs: if it is unavailable or the backend stops,
    # they stay in the database as undecided and can be re-evaluated later.
    bus.stage(run_id, "deduplicating")
    with Session(engine) as session:
        run = session.get(Run, run_id)
        assert run is not None
        run.prefiltered_out, to_match = store_results(
            session, run_id, results, terms, datetime.now(UTC)
        )
        stats = [r.stats for r in results.values()]
        run.fetched = sum(s.fetched for s in stats)
        run.skipped = sum(s.skipped for s in stats)
        run.new = sum(s.new for s in stats)
        run.unique = run.new + sum(s.known for s in stats)
        run.estimated_cost_usd = sum(s.cost_usd for s in stats)
        run.sources_json = json.dumps({name: r.stats.model_dump() for name, r in results.items()})
        errors = {name: "; ".join(r.errors) for name, r in results.items() if r.errors}
        run.errors_json = json.dumps(errors)
        session.add(run)
        session.commit()

    bus.stage(run_id, "matching")
    counts = await match_jobs(
        engine,
        to_match,
        deps.llm,
        model,
        profile,
        concurrency=deps.llm_concurrency,
        on_progress=lambda done, total: bus.llm(run_id, done, total),
    )

    with Session(engine) as session:
        run = session.get(Run, run_id)
        assert run is not None
        run.matched = counts.matched
        run.not_matched = counts.not_matched
        run.undecided = counts.undecided
        run.state = final_state = run_state(results)
        run.finished_at = datetime.now(UTC)
        session.add(run)
        session.commit()
    bus.stage(run_id, "failed" if final_state == "failed" else "done")


def fail_interrupted_runs(engine: Engine) -> None:
    """On startup: a run still marked `running` belongs to a process that no longer exists."""
    with Session(engine) as session:
        try:
            interrupted = session.exec(select(Run).where(Run.state == "running")).all()
        except SQLAlchemyError:
            return  # schema not migrated yet; /api/health reports that
        for run in interrupted:
            run.state = "failed"
            run.finished_at = datetime.now(UTC)
            run.errors_json = json.dumps({"run": INTERRUPTED})
            session.add(run)
        session.commit()
