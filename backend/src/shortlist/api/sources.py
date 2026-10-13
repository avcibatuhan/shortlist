from fastapi import APIRouter
from pydantic import BaseModel

from shortlist.api.jobs import SourceName
from shortlist.db import SessionDep
from shortlist.owner_settings import default_limit, get_settings, searches_for
from shortlist.sources import SOURCES
from shortlist.sources.base import Search

router = APIRouter(prefix="/sources", tags=["sources"])


class SourceOut(BaseModel):
    name: SourceName
    default_limit: int
    searches: list[Search]


@router.get("")
def list_sources(session: SessionDep) -> list[SourceOut]:
    """The sources a run can fetch from, with their configured searches."""
    settings = get_settings(session)
    return [
        SourceOut.model_validate(
            {
                "name": name,
                "default_limit": default_limit(settings, name),
                "searches": searches_for(settings, name),
            }
        )
        for name in SOURCES
    ]
