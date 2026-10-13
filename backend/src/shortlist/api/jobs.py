from collections import defaultdict
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, col, func, or_, select
from sqlmodel.sql.expression import SelectOfScalar

from shortlist.db import SessionDep
from shortlist.models import Job, JobEvent, JobSource, MatchDecision
from shortlist.pipeline.match import latest_decision_ids

router = APIRouter(prefix="/jobs", tags=["jobs"])

JobStatus = Literal["new", "saved", "applied", "interview", "rejected", "ignored"]
Remote = Literal["onsite", "hybrid", "remote", "unknown"]
SourceName = Literal["linkedin", "indeed", "stepstone"]
Decision = Literal["match", "no_match", "undecided"]

TRACKED_STATUSES = ("saved", "applied", "interview", "rejected")


class JobSourceOut(BaseModel):
    source: SourceName
    url: str


class JobOut(BaseModel):
    id: int
    title: str
    company: str
    location: str | None
    remote: Remote
    posted_at: datetime | None
    employment_type: str | None
    salary_text: str | None
    description: str
    description_is_snippet: bool
    language: str
    first_seen_run_id: int
    first_seen_at: datetime
    status: JobStatus
    status_changed_at: datetime | None
    note: str
    filter_reason: str | None
    # Latest LLM decision: true / false, or null when undecided or not evaluated yet.
    match: bool | None
    match_reason: str | None
    # The owner's own verdict; when set it decides where the job is listed.
    owner_label: bool | None
    sources: list[JobSourceOut]


class JobUpdate(BaseModel):
    """Only the fields that are sent are changed. `owner_label: null` clears the verdict."""

    status: JobStatus | None = None
    note: str | None = Field(default=None, max_length=2000)
    owner_label: bool | None = None


def jobs_out(session: Session, rows: list[tuple[Job, MatchDecision | None]]) -> list[JobOut]:
    sources: defaultdict[int, list[JobSource]] = defaultdict(list)
    job_ids = [job.id for job, _ in rows]
    for source in session.exec(select(JobSource).where(col(JobSource.job_id).in_(job_ids))).all():
        sources[source.job_id].append(source)
    return [
        JobOut.model_validate(
            {
                **job.model_dump(),
                "match": found.match if found else None,
                "match_reason": found.reason if found else None,
                "sources": sources[job.id or 0],
            },
            from_attributes=True,
        )
        for job, found in rows
    ]


def jobs_query(
    *,
    status: str | None = None,
    tracked: bool | None = None,
    run_id: int | None = None,
    filtered: bool | None = None,
    decision: Decision | None = None,
) -> SelectOfScalar[tuple[Job, MatchDecision | None]] | Any:
    """Jobs with their latest LLM decision, narrowed by the list filters (see `list_jobs`)."""
    latest = latest_decision_ids()
    query = (
        select(Job, MatchDecision)
        .outerjoin(latest, latest.c.job_id == Job.id)
        .outerjoin(MatchDecision, col(MatchDecision.id) == latest.c.decision_id)
    )
    if status is not None:
        query = query.where(Job.status == status)
    if tracked is not None:
        in_tracker = col(Job.status).in_(TRACKED_STATUSES)
        query = query.where(in_tracker if tracked else ~in_tracker)
    if run_id is not None:
        query = query.where(Job.first_seen_run_id == run_id)

    labelled = col(Job.owner_label).is_not(None)
    prefiltered = col(Job.filter_reason).is_not(None)
    if decision is not None:
        wanted = {"match": True, "no_match": False, "undecided": None}[decision]
        effective = func.coalesce(col(Job.owner_label), col(MatchDecision.match))
        query = query.where(effective.is_(wanted), or_(~prefiltered, labelled))
    if filtered is True:
        query = query.where(prefiltered, ~labelled)
    elif filtered is False:
        query = query.where(or_(~prefiltered, labelled))
    return query


def count_jobs(session: Session, **filters: Any) -> int:
    """How many jobs match the list filters, without the list's row limit."""
    matching = jobs_query(**filters).with_only_columns(col(Job.id)).subquery()
    return session.exec(select(func.count()).select_from(matching)).one()


@router.get("")
def list_jobs(
    session: SessionDep,
    status: JobStatus | None = None,
    tracked: bool | None = None,
    run_id: int | None = None,
    filtered: bool | None = None,
    decision: Decision | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[JobOut]:
    """Jobs, newest run first.

    - `tracked`: only jobs on the Tracker (saved, applied, interview, rejected).
    - `decision`: by the owner's verdict if there is one, else by the latest LLM decision;
      `undecided` also covers jobs that were never evaluated.
    - `filtered`: only (true) or without (false) jobs the prefilter dropped. A filtered job
      with an owner verdict counts as decided, not as filtered.
    """
    query = (
        jobs_query(
            status=status, tracked=tracked, run_id=run_id, filtered=filtered, decision=decision
        )
        .order_by(col(Job.first_seen_run_id).desc(), col(Job.id))
        .limit(limit)
    )
    return jobs_out(session, list(session.exec(query).all()))


def job_out(session: Session, job_id: int) -> JobOut:
    row = session.exec(jobs_query().where(Job.id == job_id)).first()
    if row is None:
        raise HTTPException(404, "Job not found")
    return jobs_out(session, [row])[0]


@router.get("/{job_id}", responses={404: {}})
def read_job(job_id: int, session: SessionDep) -> JobOut:
    return job_out(session, job_id)


@router.patch("/{job_id}", responses={404: {}})
def update_job(job_id: int, body: JobUpdate, session: SessionDep) -> JobOut:
    """Change status, note or the owner's verdict. Status and verdict changes are logged."""
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    now = datetime.now(UTC)
    sent = body.model_fields_set

    if "status" in sent and body.status is not None and body.status != job.status:
        job.status = body.status
        job.status_changed_at = now
        session.add(JobEvent(job_id=job_id, kind="status", value=body.status, created_at=now))
    if "note" in sent and body.note is not None:
        job.note = body.note.strip()
    if "owner_label" in sent and body.owner_label != job.owner_label:
        job.owner_label = body.owner_label
        value = "cleared" if body.owner_label is None else "yes" if body.owner_label else "no"
        session.add(JobEvent(job_id=job_id, kind="label", value=value, created_at=now))
    session.add(job)
    session.commit()

    return job_out(session, job_id)
