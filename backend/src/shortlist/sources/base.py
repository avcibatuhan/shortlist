from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

RawItem = dict[str, Any]


class Search(BaseModel):
    """One search of a source, as configured in Settings."""

    model_config = ConfigDict(str_strip_whitespace=True)

    keyword: str = Field(min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    posted_within_days: int | None = Field(default=1, ge=1, le=365)


@dataclass(frozen=True)
class NormalizedJob:
    """A job in the common format. Unknown fields stay None / "unknown" — never invented."""

    source: str
    source_job_id: str
    url: str
    title: str
    company: str
    location: str | None
    remote: str  # onsite | hybrid | remote | unknown
    posted_at: datetime | None
    employment_type: str | None
    salary_text: str | None
    description: str
    description_is_snippet: bool
    language: str  # de | en | other


class Source(Protocol):
    """Adapter for one Apify Actor: builds its input and converts its output."""

    name: str
    actor_id: str

    def build_input(self, search: Search, limit: int) -> RawItem:
        """Actor input for one search. Must carry `limit` as the Actor's explicit result cap."""
        ...

    def normalize(self, item: RawItem) -> NormalizedJob | None:
        """Convert one dataset item; None when it is not a usable job (e.g. no id or title)."""
        ...
