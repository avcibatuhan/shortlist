"""LLM match decision (spec §6.5): one job per request, schema-valid output only."""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Engine, Subquery
from sqlmodel import Session, col, func, select

from shortlist.llm.ollama_client import LLMClient, LLMUnavailable
from shortlist.llm.prompts import ACTIVE_PROMPT, JobText, Prompt, user_prompt
from shortlist.models import Job, MatchDecision

logger = logging.getLogger(__name__)

MAX_REASON_CHARS = 400
INVALID_OUTPUT = "The model did not return a valid decision."


@dataclass(frozen=True)
class MatchResult:
    match: bool | None  # None = could not decide
    reason: str
    latency_ms: int
    unavailable: bool = False  # the LLM could not be used at all


@dataclass
class MatchCounts:
    matched: int = 0
    not_matched: int = 0
    undecided: int = 0

    def add(self, match: bool | None) -> None:
        if match is None:
            self.undecided += 1
        elif match:
            self.matched += 1
        else:
            self.not_matched += 1


async def decide(
    llm: LLMClient, model: str, profile: str, job: JobText, prompt: Prompt = ACTIVE_PROMPT
) -> MatchResult:
    """Ask the model; on invalid output ask once more, then give up as undecided."""
    started = time.monotonic()

    def elapsed_ms() -> int:
        return round((time.monotonic() - started) * 1000)

    question = user_prompt(profile, job)
    for _attempt in range(2):
        try:
            raw = await llm.chat_json(model, prompt.system, question, prompt.schema)
        except LLMUnavailable as exc:
            return MatchResult(None, str(exc), elapsed_ms(), unavailable=True)
        decision = prompt.parse(raw)
        if decision is not None:
            reason = " ".join(decision.reason.split())[:MAX_REASON_CHARS]
            return MatchResult(decision.match, reason, elapsed_ms())
        logger.warning("Invalid LLM output for %r: %.200r", job.title, raw)
    return MatchResult(None, INVALID_OUTPUT, elapsed_ms())


def job_text(job: Job) -> JobText:
    return JobText(
        title=job.title,
        company=job.company,
        location=job.location,
        remote=job.remote,
        employment_type=job.employment_type,
        salary_text=job.salary_text,
        description=job.description,
        description_is_snippet=job.description_is_snippet,
    )


def latest_decision_ids() -> Subquery:
    """Per job, the id of its most recent decision (columns: job_id, decision_id)."""
    return (
        select(MatchDecision.job_id, func.max(MatchDecision.id).label("decision_id"))
        .group_by(col(MatchDecision.job_id))
        .subquery()
    )


def undecided_job_ids(session: Session) -> list[int]:
    """Jobs for the LLM to (re)evaluate: passed the prefilter, no valid decision yet, and no
    verdict from the owner (which would make the LLM's answer irrelevant)."""
    latest = latest_decision_ids()
    query = (
        select(Job.id)
        .outerjoin(latest, latest.c.job_id == Job.id)
        .outerjoin(MatchDecision, col(MatchDecision.id) == latest.c.decision_id)
        .where(
            col(Job.filter_reason).is_(None),
            col(MatchDecision.match).is_(None),
            col(Job.owner_label).is_(None),
        )
        .order_by(col(Job.id))
    )
    return [job_id for job_id in session.exec(query).all() if job_id is not None]


async def match_jobs(
    engine: Engine,
    job_ids: list[int],
    llm: LLMClient,
    model: str,
    profile: str,
    *,
    concurrency: int = 1,
    on_progress: Callable[[int, int], None] | None = None,
) -> MatchCounts:
    """Decide every job and store one MatchDecision each. Never drops a job: what cannot be
    decided is stored as undecided. Once the LLM is unavailable the rest is not attempted."""
    counts = MatchCounts()
    total = len(job_ids)
    done = 0
    unavailable: str | None = None
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def one(job_id: int) -> None:
        nonlocal done, unavailable
        async with semaphore:
            with Session(engine) as session:
                job = session.get(Job, job_id)
                text = job_text(job) if job is not None else None
            if text is None:
                result = None
            elif unavailable is not None:
                result = MatchResult(None, unavailable, 0, unavailable=True)
            else:
                result = await decide(llm, model, profile, text)
                if result.unavailable:
                    unavailable = result.reason
            if result is not None:
                with Session(engine) as session:
                    session.add(
                        MatchDecision(
                            job_id=job_id,
                            match=result.match,
                            reason=result.reason,
                            model=model,
                            prompt_version=ACTIVE_PROMPT.version,
                            latency_ms=result.latency_ms,
                            created_at=datetime.now(UTC),
                        )
                    )
                    session.commit()
                counts.add(result.match)
            done += 1
            if on_progress is not None:
                on_progress(done, total)

    if on_progress is not None:
        on_progress(0, total)
    await asyncio.gather(*(one(job_id) for job_id in job_ids))
    return counts
