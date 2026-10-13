from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

# Named constraints so Alembic's SQLite batch migrations can alter/drop them later.
SQLModel.metadata.naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Run(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    started_at: datetime
    finished_at: datetime | None = None
    state: str = "running"  # running | done | failed | partial
    limits_json: str = "{}"  # limits used per source
    # fetched = skipped + duplicates within the run + unique; unique = already known + new
    fetched: int = 0
    skipped: int = 0  # items without id, title or link
    unique: int = 0
    new: int = 0
    prefiltered_out: int = 0
    matched: int = 0
    not_matched: int = 0
    undecided: int = 0
    estimated_cost_usd: float = 0.0
    errors_json: str = "{}"  # per-source errors
    sources_json: str = "{}"  # per-source counts and cost (pipeline.run.SourceStats)


class Job(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    fingerprint: str = Field(unique=True, index=True)  # dedup key
    title: str
    company: str
    location: str | None = None
    remote: str = "unknown"  # onsite | hybrid | remote | unknown
    posted_at: datetime | None = None
    employment_type: str | None = None
    salary_text: str | None = None
    description: str  # plain text; may be a short snippet (StepStone)
    description_is_snippet: bool = False
    language: str = "other"  # de | en | other
    first_seen_run_id: int = Field(foreign_key="run.id", index=True)
    first_seen_at: datetime
    status: str = Field(default="new", index=True)
    # status: new | saved | applied | interview | rejected | ignored
    filter_reason: str | None = None  # set when the prefilter dropped the job before the LLM
    status_changed_at: datetime | None = None
    note: str = ""  # the owner's note on the Tracker
    # The owner's own verdict "this job fits me"; overrides the LLM decision and is a label
    # for the evaluation. None = no verdict given.
    owner_label: bool | None = None


class JobSource(SQLModel, table=True):
    """One job can come from several sources."""

    __table_args__ = (UniqueConstraint("source", "source_job_id"),)

    id: int | None = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    source: str  # linkedin | indeed | stepstone
    source_job_id: str
    url: str


class JobEvent(SQLModel, table=True):
    """The owner's actions on a job, in order: status changes and labels."""

    id: int | None = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    kind: str  # status | label
    value: str  # the new status, or yes | no | cleared
    created_at: datetime


class CoverLetter(SQLModel, table=True):
    """A cover letter draft for a job; one per job, replaced when written again."""

    id: int | None = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id", index=True, unique=True)
    language: str  # de | en
    text: str  # as generated, or as edited by the owner
    edited: bool = False
    model: str
    latency_ms: int
    created_at: datetime
    updated_at: datetime


class MatchDecision(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    match: bool | None = None  # None = could not decide
    reason: str | None = None  # one sentence
    model: str
    prompt_version: str
    latency_ms: int
    created_at: datetime


class Settings(SQLModel, table=True):
    """Owner-editable settings; single row (id = 1)."""

    id: int | None = Field(default=None, primary_key=True)
    full_name: str = ""  # signs cover letters; never sent to the LLM for match decisions
    profile_text: str
    searches_json: str  # per-source search config
    exclude_terms_json: str
    monthly_budget_usd: float
    model_name: str
    default_limits_json: str = "{}"  # per-source result limit preselected on the Run page
    prices_json: str = "{}"  # per-source price overrides; config/prices.yaml otherwise
