from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"  # raw Actor output per run, kept 14 days
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

# The backend is local-only by design; there is no setting to change this.
HOST = "127.0.0.1"


class AppConfig(BaseSettings):
    """Process configuration from the environment / repo-root `.env`.

    Owner-editable settings (profile, searches, budget, model) live in the database instead.
    """

    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    apify_token: str | None = None
    ollama_url: str = "http://127.0.0.1:11434"
    database_url: str = f"sqlite:///{DATA_DIR / 'shortlist.db'}"
    # Parallel LLM requests. 1 suits a single GPU.
    llm_concurrency: int = 1


@lru_cache
def get_config() -> AppConfig:
    return AppConfig()
