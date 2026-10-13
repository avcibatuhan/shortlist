"""Indeed Germany via `valig/indeed-jobs-scraper`. Field mapping: docs/actors.md."""

from datetime import datetime
from typing import Any

from shortlist.pipeline.normalize import clean_text, detect_language, optional_text
from shortlist.sources.base import NormalizedJob, RawItem, Search

# The Actor only accepts these values for `datePosted` ("" = any date).
DATE_POSTED_DAYS = (1, 3, 7, 14)

# Labels in `attributes` that state the workplace. Only labels seen in real output are mapped.
# "Homeoffice" came with the location "Home Office"; "Homeoffice-Möglichkeit" does not say how
# much and is left out.
REMOTE_BY_LABEL = {"Hybrides Arbeiten": "hybrid", "Homeoffice": "remote"}

SALARY_UNITS = {"YEAR": "year", "MONTH": "month", "WEEK": "week", "DAY": "day", "HOUR": "hour"}


class IndeedSource:
    name = "indeed"
    actor_id = "valig/indeed-jobs-scraper"

    def build_input(self, search: Search, limit: int) -> RawItem:
        run_input: RawItem = {
            "country": "de",
            "title": search.keyword,
            "datePosted": date_posted(search.posted_within_days),
            "limit": limit,
        }
        if search.location:
            run_input["location"] = search.location
        return run_input

    def normalize(self, item: RawItem) -> NormalizedJob | None:
        key = item.get("key")
        title = optional_text(item.get("title"))
        url = item.get("url")
        if not key or title is None or not isinstance(url, str) or not url:
            return None
        description = clean_text(_dict(item.get("description")).get("text"))
        language = item.get("language")
        return NormalizedJob(
            source=self.name,
            source_job_id=str(key),
            url=url,
            title=title,
            company=optional_text(_dict(item.get("employer")).get("name")) or "",
            location=optional_text(_dict(item.get("location")).get("city")),
            remote=remote(_dict(item.get("attributes"))),
            posted_at=parse_datetime(item.get("datePublished")),
            employment_type=", ".join(_labels(item.get("jobTypes"))) or None,
            salary_text=salary_text(_dict(item.get("baseSalary"))),
            description=description,
            description_is_snippet=False,
            language=language
            if language in ("de", "en")
            else detect_language(f"{title} {description}"),
        )


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _labels(value: object) -> list[str]:
    """Indeed lists are `{code: label}` objects."""
    return [label for label in _dict(value).values() if isinstance(label, str) and label]


def date_posted(days: int | None) -> str:
    """Smallest window the Actor supports that covers `days`; "" (any date) beyond 14 days."""
    if days is None:
        return ""
    return next((str(d) for d in DATE_POSTED_DAYS if days <= d), "")


def remote(attributes: dict[str, Any]) -> str:
    for label in _labels(attributes):
        if label in REMOTE_BY_LABEL:
            return REMOTE_BY_LABEL[label]
    return "unknown"


def salary_text(salary: dict[str, Any]) -> str | None:
    """ "42,300 - 75,000 EUR per year" from `baseSalary`; None when no amount is given."""
    amounts = [a for a in (salary.get("min"), salary.get("max")) if isinstance(a, int | float)]
    if not amounts:
        return None
    parts = [" - ".join(f"{a:,.0f}" for a in dict.fromkeys(amounts))]
    if isinstance(salary.get("currencyCode"), str):
        parts.append(salary["currencyCode"])
    unit = SALARY_UNITS.get(str(salary.get("unitOfWork")))
    if unit:
        parts.append(f"per {unit}")
    return " ".join(parts)


def parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.utcoffset() is not None else None
