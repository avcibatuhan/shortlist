from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from shortlist.db import SessionDep

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "error"]
    schema_revision: str | None
    detail: str | None


@router.get("/health")
def health(session: SessionDep) -> HealthResponse:
    """Backend is up if this answers; the database is OK if its migrated schema is readable."""
    try:
        revision = (
            session.connection()
            .execute(text("SELECT version_num FROM alembic_version"))
            .scalar_one_or_none()
        )
    except SQLAlchemyError as exc:
        return HealthResponse(
            status="degraded",
            database="error",
            schema_revision=None,
            detail=f"{type(exc).__name__}: run `make migrate`",
        )
    if revision is None:
        return HealthResponse(
            status="degraded",
            database="error",
            schema_revision=None,
            detail="No schema revision: run `make migrate`",
        )
    return HealthResponse(status="ok", database="ok", schema_revision=revision, detail=None)
