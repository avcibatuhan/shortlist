"""LinkedIn via `curious_coder/linkedin-jobs-scraper`. Field mapping: docs/actors.md."""

from datetime import UTC, date, datetime

from shortlist.pipeline.normalize import clean_text, detect_language, optional_text
from shortlist.sources.base import NormalizedJob, RawItem, Search

# `datePosted` values of the Actor, by the number of days each one covers.
DATE_POSTED = ((1, "past24Hours"), (7, "pastWeek"), (30, "pastMonth"))


class LinkedInSource:
    name = "linkedin"
    actor_id = "curious_coder/linkedin-jobs-scraper"

    def build_input(self, search: Search, limit: int) -> RawItem:
        run_input: RawItem = {
            "keywords": search.keyword,
            "datePosted": date_posted(search.posted_within_days),
            "limitPerSource": limit,
            # Company pages cost extra requests per job; the company name is in the job itself.
            "scrapeCompany": False,
        }
        if search.location:
            run_input["location"] = search.location
        return run_input

    def normalize(self, item: RawItem) -> NormalizedJob | None:
        job_id = item.get("id")
        title = optional_text(item.get("title"))
        link = item.get("link")
        if not job_id or title is None or not isinstance(link, str) or not link:
            return None
        description = clean_text(item.get("descriptionText") or item.get("descriptionHtml"))
        return NormalizedJob(
            source=self.name,
            source_job_id=str(job_id),
            url=link.split("?")[0],  # drop tracking parameters
            title=title,
            company=optional_text(item.get("companyName")) or "",
            location=optional_text(item.get("location")),
            remote="unknown",  # no workplace field in the Actor output
            posted_at=parse_date(item.get("postedAt")),
            employment_type=optional_text(item.get("employmentType")),
            salary_text=optional_text(item.get("salary")),
            description=description,
            description_is_snippet=False,
            language=detect_language(f"{title} {description}"),
        )


def date_posted(days: int | None) -> str:
    """Smallest window the Actor supports that covers `days`."""
    if days is None:
        return "anyTime"
    return next((value for limit, value in DATE_POSTED if days <= limit), "anyTime")


def parse_date(value: object) -> datetime | None:
    """LinkedIn gives the day only ("2026-10-12"); stored as that day at 00:00 UTC."""
    if not isinstance(value, str):
        return None
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return None
    return datetime(day.year, day.month, day.day, tzinfo=UTC)
