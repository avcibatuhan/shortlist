"""Live run progress for the dashboard: an in-memory bus read by the SSE endpoint."""

import asyncio
from collections.abc import AsyncIterator
from typing import Literal

from pydantic import BaseModel

SourceState = Literal["pending", "fetching", "normalizing", "done", "error"]
Stage = Literal["fetching", "deduplicating", "matching", "done", "failed"]
FINAL_STAGES: frozenset[Stage] = frozenset({"done", "failed"})


class SourceProgress(BaseModel):
    state: SourceState = "pending"
    fetched: int = 0
    error: str | None = None


class RunProgress(BaseModel):
    run_id: int
    stage: Stage = "fetching"
    sources: dict[str, SourceProgress]
    # LLM decisions made / to make in this run (stage "matching")
    llm_done: int = 0
    llm_total: int = 0


class ProgressBus:
    """Latest progress per active run, pushed to every subscriber on each change."""

    def __init__(self) -> None:
        self._latest: dict[int, RunProgress] = {}
        self._subscribers: dict[int, set[asyncio.Queue[RunProgress]]] = {}

    def start(self, run_id: int, sources: list[str]) -> None:
        self._latest[run_id] = RunProgress(
            run_id=run_id, sources={name: SourceProgress() for name in sources}
        )
        self._publish(run_id)

    def source(
        self,
        run_id: int,
        name: str,
        state: SourceState,
        *,
        fetched: int | None = None,
        error: str | None = None,
    ) -> None:
        progress = self._latest.get(run_id)
        if progress is None:
            return
        source = progress.sources[name]
        source.state = state
        if fetched is not None:
            source.fetched = fetched
        if error is not None:
            source.error = error
        self._publish(run_id)

    def llm(self, run_id: int, done: int, total: int) -> None:
        progress = self._latest.get(run_id)
        if progress is None:
            return
        progress.llm_done = done
        progress.llm_total = total
        self._publish(run_id)

    def stage(self, run_id: int, stage: Stage) -> None:
        progress = self._latest.get(run_id)
        if progress is None:
            return
        progress.stage = stage
        self._publish(run_id)
        if stage in FINAL_STAGES:
            # Subscribers already hold the final snapshot; later ones read the run from the DB.
            del self._latest[run_id]
            self._subscribers.pop(run_id, None)

    def latest(self, run_id: int) -> RunProgress | None:
        progress = self._latest.get(run_id)
        return progress.model_copy(deep=True) if progress is not None else None

    async def subscribe(self, run_id: int) -> AsyncIterator[RunProgress]:
        """Current progress, then every change until the run reaches a final stage."""
        current = self.latest(run_id)
        if current is None:
            return
        queue: asyncio.Queue[RunProgress] = asyncio.Queue()
        self._subscribers.setdefault(run_id, set()).add(queue)
        try:
            yield current
            while current.stage not in FINAL_STAGES:
                current = await queue.get()
                yield current
        finally:
            self._subscribers.get(run_id, set()).discard(queue)

    def _publish(self, run_id: int) -> None:
        snapshot = self._latest[run_id]
        for queue in self._subscribers.get(run_id, ()):
            queue.put_nowait(snapshot.model_copy(deep=True))
