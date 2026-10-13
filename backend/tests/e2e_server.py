"""Backend for the Playwright e2e test: built frontend, throwaway database, no Apify, no Ollama.

Run from `backend/`: `uv run python -m tests.e2e_server`
"""

import json
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Any

import uvicorn

from shortlist.config import FRONTEND_DIST, HOST
from shortlist.db import make_engine, run_migrations
from shortlist.defaults import SEARCHES
from shortlist.llm.ollama_client import ModelStatus
from shortlist.main import create_app
from shortlist.sources import SOURCES
from shortlist.sources.base import RawItem
from tests.conftest import load_fixture

PORT = 8010


ACTOR_SOURCES = {source.actor_id: name for name, source in SOURCES.items()}
KEYWORD_FIELDS = ("keyword", "keywords", "title")  # StepStone, LinkedIn, Indeed


class FixtureFetcher:
    """Deals each source's fixture out to its default searches, the same way on every run."""

    async def fetch(
        self, actor_id: str, run_input: RawItem, limit: int, max_charge_usd: Decimal
    ) -> list[RawItem]:
        source = ACTOR_SOURCES[actor_id]
        keywords = [search.keyword for search in SEARCHES[source]]
        keyword = next(run_input[name] for name in KEYWORD_FIELDS if name in run_input)
        position = keywords.index(keyword)
        return load_fixture(f"{source}.json")[position :: len(keywords)][:limit]


class KeywordLLM:
    """Says yes to developer and engineer titles, no to everything else."""

    async def chat_json(self, model: str, system: str, user: str, schema: dict[str, Any]) -> str:
        title = user.split("Title: ", 1)[1].splitlines()[0].lower()
        match = "developer" in title or "engineer" in title
        reason = "Software development role." if match else "Title does not name a developer role."
        return json.dumps({"match": match, "reason": reason})

    async def chat_text(
        self, model: str, system: str, user: str, *, temperature: float, max_tokens: int
    ) -> str:
        title = user.split("Title: ", 1)[1].splitlines()[0]
        if "in German" in system:
            return (
                f"Bewerbung als {title}\n\nSehr geehrte Damen und Herren,\n\n"
                "mit großem Interesse habe ich Ihre Ausschreibung gelesen.\n\n"
                "Mit freundlichen Grüßen\n[Ihr Name]"
            )
        return (
            f"Application for {title}\n\nDear Hiring Team,\n\n"
            "I read your posting with great interest.\n\nKind regards,\n[Your name]"
        )

    async def model_status(self, model: str) -> ModelStatus | None:
        return ModelStatus(size_bytes=1000, vram_bytes=1000, context_length=8192)

    async def list_models(self) -> list[str]:
        return ["gemma4:12b-it-qat", "qwen3.5:9b"]


def main() -> None:
    if not (FRONTEND_DIST / "index.html").is_file():
        raise SystemExit("Build the frontend first: cd frontend && pnpm build")
    with tempfile.TemporaryDirectory() as tmp:
        database_url = f"sqlite:///{Path(tmp) / 'e2e.db'}"
        run_migrations(database_url)
        app = create_app(
            engine=make_engine(database_url),
            fetcher=FixtureFetcher(),
            llm=KeywordLLM(),
            raw_dir=Path(tmp) / "raw",
        )
        uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
