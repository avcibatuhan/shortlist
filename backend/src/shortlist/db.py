from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from sqlalchemy import Engine
from sqlalchemy.engine import make_url
from sqlmodel import Session, create_engine

from shortlist.config import BACKEND_DIR, get_config


def make_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    connect_args: dict[str, object] = {}
    if url.get_backend_name() == "sqlite":
        # FastAPI runs sync endpoints in a thread pool.
        connect_args["check_same_thread"] = False
    return create_engine(url, connect_args=connect_args)


@lru_cache
def get_engine() -> Engine:
    return make_engine(get_config().database_url)


def app_engine(request: Request) -> Engine:
    """The engine the app was created with (tests pass their own)."""
    engine: Engine = request.app.state.engine
    return engine


def get_session(engine: Annotated[Engine, Depends(app_engine)]) -> Iterator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
EngineDep = Annotated[Engine, Depends(app_engine)]


def alembic_config(database_url: str) -> Config:
    cfg = Config(BACKEND_DIR / "alembic.ini")
    # Config values go through %-interpolation.
    cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return cfg


def run_migrations(database_url: str) -> None:
    """Create the SQLite file's directory if needed and upgrade the schema to head."""
    url = make_url(database_url)
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(database_url), "head")
