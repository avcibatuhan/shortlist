import json
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints

from shortlist.api.jobs import SourceName
from shortlist.config import get_config
from shortlist.db import SessionDep
from shortlist.llm.ollama_client import LLMClient, LLMUnavailable
from shortlist.llm.prompts import JobText
from shortlist.models import Settings
from shortlist.owner_settings import (
    default_limit,
    exclude_terms,
    get_settings,
    prices_for,
    searches_for,
)
from shortlist.pipeline.match import decide
from shortlist.prices import SourcePrice
from shortlist.sources import SOURCES
from shortlist.sources.base import Search

router = APIRouter(prefix="/settings", tags=["settings"])

MAX_SEARCHES_PER_SOURCE = 10

# A clear "yes" for the default profile, so a working model answers match = true.
SAMPLE_JOB = JobText(
    title="Software Developer C# / .NET (m/w/d)",
    company="Beispiel GmbH",
    location="Berlin",
    remote="hybrid",
    employment_type="Full-time",
    salary_text=None,
    description=(
        "We are looking for a software developer with 2-3 years of experience in C# and "
        "ASP.NET Core to build web applications together with our React frontend team. "
        "English or German at a professional level."
    ),
    description_is_snippet=False,
)

Term = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class SettingsBody(BaseModel):
    """Everything the owner can edit. Every source must be present in the per-source maps."""

    # Signs cover letters. Optional: without it the letter ends with a placeholder.
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""
    profile_text: str = Field(min_length=1, max_length=8000)
    searches: dict[SourceName, Annotated[list[Search], Field(max_length=MAX_SEARCHES_PER_SOURCE)]]
    default_limits: dict[SourceName, Annotated[int, Field(ge=1, le=1000)]]
    exclude_terms: Annotated[list[Term], Field(max_length=50)]
    monthly_budget_usd: float = Field(ge=0, le=10_000)
    prices: dict[SourceName, SourcePrice]
    model_name: str = Field(min_length=1, max_length=200, pattern=r"^\S+$")


class SettingsOut(SettingsBody):
    ollama_url: str
    # The token itself lives only in .env and is never sent to the browser.
    apify_token_configured: bool


class ModelChoice(BaseModel):
    model_name: str = Field(min_length=1, max_length=200, pattern=r"^\S+$")


class Models(BaseModel):
    current: str  # the model the app uses
    installed: list[str]  # models Ollama has, by name
    error: str | None  # why the list could not be read


class ModelTest(BaseModel):
    ok: bool  # the model answered with a valid decision
    model_name: str
    latency_ms: int
    match: bool | None
    reason: str  # the model's reason, or what went wrong
    # Share of the model that is on the GPU, and its context size (None if not loaded)
    gpu_percent: int | None
    context_length: int | None


def settings_out(settings: Settings) -> SettingsOut:
    config = get_config()
    return SettingsOut.model_validate(
        {
            "full_name": settings.full_name,
            "profile_text": settings.profile_text,
            "searches": {name: searches_for(settings, name) for name in SOURCES},
            "default_limits": {name: default_limit(settings, name) for name in SOURCES},
            "exclude_terms": exclude_terms(settings),
            "monthly_budget_usd": settings.monthly_budget_usd,
            "prices": prices_for(settings),
            "model_name": settings.model_name,
            "ollama_url": config.ollama_url,
            "apify_token_configured": bool(config.apify_token),
        },
        from_attributes=True,
    )


@router.get("")
def read_settings(session: SessionDep) -> SettingsOut:
    return settings_out(get_settings(session))


@router.put("", responses={400: {}})
def write_settings(body: SettingsBody, session: SessionDep) -> SettingsOut:
    """Replace the owner's settings. They apply from the next run; no restart needed."""
    for field in ("searches", "default_limits", "prices"):
        missing = sorted(set(SOURCES) - set(getattr(body, field)))
        if missing:
            raise HTTPException(400, f"{field}: missing source(s) {', '.join(missing)}")

    settings = get_settings(session)
    settings.full_name = body.full_name
    settings.profile_text = body.profile_text
    settings.searches_json = json.dumps(
        {name: [s.model_dump() for s in searches] for name, searches in body.searches.items()}
    )
    settings.default_limits_json = json.dumps(body.default_limits)
    settings.exclude_terms_json = json.dumps(list(dict.fromkeys(body.exclude_terms)))
    settings.monthly_budget_usd = body.monthly_budget_usd
    settings.prices_json = json.dumps(
        {name: price.model_dump() for name, price in body.prices.items()}
    )
    settings.model_name = body.model_name
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings_out(settings)


@router.get("/models")
async def list_models(request: Request, session: SessionDep) -> Models:
    """The model in use and the models installed in Ollama, for the model picker."""
    current = get_settings(session).model_name
    llm: LLMClient = request.app.state.llm
    try:
        return Models(current=current, installed=await llm.list_models(), error=None)
    except LLMUnavailable as exc:
        return Models(current=current, installed=[], error=str(exc))


@router.put("/model")
def choose_model(body: ModelChoice, session: SessionDep) -> ModelChoice:
    """Switch the LLM. Applies to the next decision or letter; no restart needed."""
    settings = get_settings(session)
    settings.model_name = body.model_name
    session.add(settings)
    session.commit()
    return body


@router.post("/model/test")
async def test_model(request: Request, session: SessionDep) -> ModelTest:
    """Ask the saved model for a decision on a sample job and report how it went."""
    settings = get_settings(session)
    llm: LLMClient = request.app.state.llm
    result = await decide(llm, settings.model_name, settings.profile_text, SAMPLE_JOB)
    placement = await llm.model_status(settings.model_name)
    return ModelTest(
        ok=result.match is not None,
        model_name=settings.model_name,
        latency_ms=result.latency_ms,
        match=result.match,
        reason=result.reason,
        gpu_percent=placement.gpu_percent if placement else None,
        context_length=placement.context_length if placement else None,
    )
