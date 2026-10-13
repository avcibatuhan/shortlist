import asyncio
import logging
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from shortlist.db import EngineDep, SessionDep
from shortlist.models import Run
from shortlist.owner_settings import get_settings
from shortlist.pipeline.match import match_jobs, undecided_job_ids

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/match", tags=["match"])


@dataclass
class MatchActivity:
    """Progress of the current (or last) re-evaluation of undecided jobs; one per app."""

    running: bool = False
    done: int = 0
    total: int = 0
    matched: int = 0
    not_matched: int = 0
    undecided: int = 0
    error: str | None = None


class MatchStatus(BaseModel):
    running: bool
    done: int
    total: int
    # Result of the last finished re-evaluation
    matched: int
    not_matched: int
    undecided: int
    error: str | None
    # Jobs currently waiting for a decision
    undecided_jobs: int


def status_of(activity: MatchActivity, session: Session) -> MatchStatus:
    return MatchStatus(
        running=activity.running,
        done=activity.done,
        total=activity.total,
        matched=activity.matched,
        not_matched=activity.not_matched,
        undecided=activity.undecided,
        error=activity.error,
        undecided_jobs=len(undecided_job_ids(session)),
    )


@router.get("/status")
def match_status(request: Request, session: SessionDep) -> MatchStatus:
    return status_of(request.app.state.match_activity, session)


@router.post("/reevaluate", status_code=202, responses={409: {}})
async def reevaluate_undecided(
    request: Request, session: SessionDep, engine: EngineDep
) -> MatchStatus:
    """Send every undecided job to the LLM again, in the background."""
    state = request.app.state
    activity: MatchActivity = state.match_activity
    if activity.running:
        raise HTTPException(409, "A re-evaluation is already running.")
    if session.exec(select(Run).where(Run.state == "running")).first() is not None:
        raise HTTPException(409, "A run is active. Try again when it is done.")

    job_ids = undecided_job_ids(session)
    settings = get_settings(session)
    profile, model = settings.profile_text, settings.model_name
    new_activity = MatchActivity(running=bool(job_ids), total=len(job_ids))
    state.match_activity = new_activity

    async def work() -> None:
        def on_progress(done: int, total: int) -> None:
            new_activity.done = done

        try:
            counts = await match_jobs(
                engine,
                job_ids,
                state.llm,
                model,
                profile,
                concurrency=state.llm_concurrency,
                on_progress=on_progress,
            )
            new_activity.matched = counts.matched
            new_activity.not_matched = counts.not_matched
            new_activity.undecided = counts.undecided
        except Exception as exc:
            logger.exception("Re-evaluation failed")
            new_activity.error = f"{type(exc).__name__}: {exc}"
        finally:
            new_activity.running = False

    if job_ids:
        task = asyncio.create_task(work())
        tasks: set[asyncio.Task[None]] = state.run_tasks
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    return status_of(new_activity, session)
