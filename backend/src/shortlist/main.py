import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Engine

from shortlist.api import (
    cover_letters,
    health,
    jobs,
    match,
    runs,
    settings,
    sources,
    stats,
)
from shortlist.config import FRONTEND_DIST, RAW_DIR, get_config
from shortlist.db import get_engine
from shortlist.events import ProgressBus
from shortlist.llm.ollama_client import LLMClient, OllamaClient
from shortlist.pipeline.fetch import RETRY_BACKOFF_SECONDS, Fetcher
from shortlist.pipeline.run import fail_interrupted_runs
from shortlist.security import LocalOnlyMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    fail_interrupted_runs(app.state.engine)
    yield
    tasks: set[asyncio.Task[None]] = app.state.run_tasks
    for task in tasks:
        task.cancel()


def create_app(
    frontend_dist: Path | None = FRONTEND_DIST,
    engine: Engine | None = None,
    fetcher: Fetcher | None = None,
    llm: LLMClient | None = None,
    raw_dir: Path = RAW_DIR,
    retry_backoff_seconds: float = RETRY_BACKOFF_SECONDS,
) -> FastAPI:
    """The parameters are injected by tests; the defaults are the real ones."""
    app = FastAPI(title="Shortlist", version="0.1.0", lifespan=lifespan)
    app.state.engine = engine if engine is not None else get_engine()
    app.state.fetcher = fetcher  # None: ApifyFetcher with the token from .env, per request
    app.state.llm = llm if llm is not None else OllamaClient(get_config().ollama_url)
    app.state.llm_concurrency = get_config().llm_concurrency
    app.state.match_activity = match.MatchActivity()
    app.state.raw_dir = raw_dir
    app.state.retry_backoff_seconds = retry_backoff_seconds
    app.state.run_tasks = set()
    app.state.progress_bus = ProgressBus()

    app.add_middleware(LocalOnlyMiddleware)

    api = APIRouter(prefix="/api")
    api.include_router(health.router)
    api.include_router(runs.router)
    api.include_router(jobs.router)
    api.include_router(cover_letters.router)
    api.include_router(sources.router)
    api.include_router(match.router)
    api.include_router(settings.router)
    api.include_router(stats.router)
    app.include_router(api)

    if frontend_dist is not None and (frontend_dist / "index.html").is_file():
        mount_frontend(app, frontend_dist)
    return app


def mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built React app (`make start`); unknown paths fall back to index.html."""
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")


app = create_app()
