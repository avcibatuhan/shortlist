import asyncio
import json
import shutil
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Protocol

import impit
from apify_client import ApifyClientAsync
from apify_client.errors import RateLimitError, ServerError

from shortlist.sources.base import RawItem

RUN_TIMEOUT = timedelta(minutes=10)
RAW_RETENTION = timedelta(days=14)
RETRY_BACKOFF_SECONDS = 5.0


class FetchError(Exception):
    """An Actor run did not finish successfully."""


class TransientFetchError(FetchError):
    """Network or Apify server (5xx / rate limit) trouble: worth one more attempt."""


class Fetcher(Protocol):
    async def fetch(
        self, actor_id: str, run_input: RawItem, limit: int, max_charge_usd: Decimal
    ) -> list[RawItem]:
        """Run the Actor and return at most `limit` dataset items."""
        ...


class ApifyFetcher:
    def __init__(self, token: str) -> None:
        self._client = ApifyClientAsync(token)

    async def fetch(
        self, actor_id: str, run_input: RawItem, limit: int, max_charge_usd: Decimal
    ) -> list[RawItem]:
        try:
            # Platform-side caps on results and total charge, on top of the Actor's own limit.
            run = await self._client.actor(actor_id).call(
                run_input=run_input,
                max_items=limit,
                max_total_charge_usd=max_charge_usd,
                run_timeout=RUN_TIMEOUT,
                logger=None,
            )
            if run is None:
                raise FetchError(f"{actor_id}: run did not finish")
            if run.status != "SUCCEEDED":
                detail = f": {run.status_message}" if run.status_message else ""
                raise FetchError(f"{actor_id}: run {run.status}{detail}")
            page = await self._client.dataset(run.default_dataset_id).list_items(limit=limit)
        except (ServerError, RateLimitError, impit.TransportError, OSError) as exc:
            raise TransientFetchError(f"{actor_id}: {type(exc).__name__}: {exc}") from exc
        return page.items


async def fetch_with_retry(
    fetcher: Fetcher,
    actor_id: str,
    run_input: RawItem,
    limit: int,
    max_charge_usd: Decimal,
    *,
    attempts: int = 2,
    backoff_seconds: float = RETRY_BACKOFF_SECONDS,
    on_attempt: Callable[[], None] | None = None,
) -> list[RawItem]:
    """Try transient failures again (2 attempts in total); anything else fails at once.

    `on_attempt` is called before every attempt: each one may start a billed Actor run.
    """
    for attempt in range(1, attempts + 1):
        if on_attempt is not None:
            on_attempt()
        try:
            return await fetcher.fetch(actor_id, run_input, limit, max_charge_usd)
        except TransientFetchError:
            if attempt == attempts:
                raise
            await asyncio.sleep(backoff_seconds * attempt)
    raise AssertionError("unreachable")


def split_limit(limit: int, parts: int) -> list[int]:
    """Split a per-source limit across its searches as evenly as possible (shares may be 0)."""
    if parts <= 0 or limit <= 0:
        return []
    base, extra = divmod(limit, parts)
    return [base + (1 if i < extra else 0) for i in range(parts)]


def save_raw(raw_dir: Path, run_id: int, source: str, items: list[RawItem]) -> None:
    target = raw_dir / str(run_id)
    target.mkdir(parents=True, exist_ok=True)
    (target / f"{source}.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))


def delete_old_raw(raw_dir: Path, now: datetime | None = None) -> None:
    """Remove raw Actor output older than 14 days."""
    if not raw_dir.is_dir():
        return
    cutoff = (now or datetime.now(UTC)) - RAW_RETENTION
    for run_dir in raw_dir.iterdir():
        if run_dir.is_dir() and datetime.fromtimestamp(run_dir.stat().st_mtime, UTC) < cutoff:
            shutil.rmtree(run_dir)
