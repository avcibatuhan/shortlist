from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from pydantic import BaseModel
from sqlmodel import col, func, select

from shortlist.api.jobs import count_jobs
from shortlist.db import SessionDep
from shortlist.models import Job, JobEvent

router = APIRouter(prefix="/stats", tags=["stats"])


class Stats(BaseModel):
    # Tracker counters
    applied_this_week: int  # jobs marked applied since Monday 00:00 UTC
    interviews_total: int  # jobs that ever reached the interview status
    # Jobs waiting in each view of the Jobs page (status "new")
    new_matches: int
    new_not_matched: int
    new_undecided: int
    new_filtered: int
    saved: int  # saved on the Tracker, not applied yet
    # Jobs with the owner's own verdict (labels for the evaluation)
    labelled: int
    labelled_relevant: int
    labelled_not_relevant: int


def week_start(now: datetime) -> datetime:
    monday = now.astimezone(UTC) - timedelta(days=now.astimezone(UTC).weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


@router.get("")
def stats(session: SessionDep) -> Stats:
    def jobs_with_event(status: str, since: datetime | None = None) -> int:
        query = select(func.count(func.distinct(JobEvent.job_id))).where(
            JobEvent.kind == "status", JobEvent.value == status
        )
        if since is not None:
            query = query.where(JobEvent.created_at >= since)
        return session.exec(query).one()

    def labelled(value: bool) -> int:
        return session.exec(select(func.count()).where(col(Job.owner_label).is_(value))).one()

    relevant, not_relevant = labelled(True), labelled(False)
    return Stats(
        applied_this_week=jobs_with_event("applied", week_start(datetime.now(UTC))),
        interviews_total=jobs_with_event("interview"),
        new_matches=count_jobs(session, status="new", decision="match"),
        new_not_matched=count_jobs(session, status="new", decision="no_match"),
        new_undecided=count_jobs(session, status="new", decision="undecided"),
        new_filtered=count_jobs(session, status="new", filtered=True),
        saved=count_jobs(session, status="saved"),
        labelled=relevant + not_relevant,
        labelled_relevant=relevant,
        labelled_not_relevant=not_relevant,
    )
