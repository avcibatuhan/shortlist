"""The owner's settings (single database row) and what the app derives from them."""

import json

from sqlmodel import Session

from shortlist.defaults import DEFAULT_LIMIT, SEARCHES, default_settings
from shortlist.models import Settings
from shortlist.prices import SourcePrice, get_prices
from shortlist.sources.base import Search


def get_settings(session: Session) -> Settings:
    """The single Settings row, created from the defaults on first use."""
    settings = session.get(Settings, 1)
    if settings is None:
        settings = default_settings()
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


def searches_for(settings: Settings, source: str) -> list[Search]:
    """Configured searches of a source; the defaults when the source has no entry yet."""
    configured = json.loads(settings.searches_json)
    if source not in configured:
        return list(SEARCHES.get(source, []))
    return [Search.model_validate(search) for search in configured[source]]


def exclude_terms(settings: Settings) -> list[str]:
    terms: list[str] = json.loads(settings.exclude_terms_json)
    return terms


def default_limit(settings: Settings, source: str) -> int:
    """Result limit preselected for a source on the Run page."""
    limits: dict[str, int] = json.loads(settings.default_limits_json)
    return limits.get(source, DEFAULT_LIMIT)


def prices_for(settings: Settings) -> dict[str, SourcePrice]:
    """Prices per source: config/prices.yaml, replaced by what was saved on the Settings page."""
    prices = dict(get_prices())
    for source, price in json.loads(settings.prices_json).items():
        prices[source] = SourcePrice.model_validate(price)
    return prices
