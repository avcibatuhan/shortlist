"""StepStone Germany via `memo23/stepstone-search-cheerio-ppr`. Field mapping: docs/actors.md."""

from datetime import datetime

from shortlist.pipeline.normalize import clean_text, detect_language, optional_text
from shortlist.sources.base import NormalizedJob, RawItem, Search

BASE_URL = "https://www.stepstone.de"
# The Actor only accepts these values for `postedWithin`.
POSTED_WITHIN_DAYS = (1, 3, 7)

# `workFromHome` codes are undocumented. Only "2" was verified against a real ad (2 days of
# mobile work per week); other codes stay "unknown" rather than guessed.
REMOTE_BY_CODE = {"2": "hybrid"}


class StepStoneSource:
    name = "stepstone"
    actor_id = "memo23/stepstone-search-cheerio-ppr"

    def build_input(self, search: Search, limit: int) -> RawItem:
        run_input: RawItem = {
            "keyword": search.keyword,
            "country": "de",
            "postedWithin": posted_within(search.posted_within_days),
            "includeRelatedJobs": False,
            "enrichEmails": False,  # paid extra — never enable
            "maxItems": limit,
        }
        if search.location:
            run_input["location"] = search.location
        return run_input

    def normalize(self, item: RawItem) -> NormalizedJob | None:
        job_id = item.get("id")
        title = optional_text(item.get("title"))
        path = item.get("url")
        if job_id is None or title is None or not isinstance(path, str) or not path:
            return None
        description = clean_text(item.get("textSnippet"))
        return NormalizedJob(
            source=self.name,
            source_job_id=str(job_id),
            url=absolute_url(path),
            title=title,
            company=optional_text(item.get("companyName")) or "",
            location=optional_text(item.get("location")),
            remote=REMOTE_BY_CODE.get(str(item.get("workFromHome")), "unknown"),
            posted_at=parse_datetime(item.get("datePosted")),
            employment_type=None,  # not in the Actor output
            salary_text=optional_text(item.get("salary")),
            description=description,
            description_is_snippet=True,
            language=detect_language(f"{title} {description}"),
        )


def posted_within(days: int | None) -> str:
    """Smallest window the Actor supports that covers `days`; "all" beyond 7 days."""
    if days is None:
        return "all"
    return next((str(d) for d in POSTED_WITHIN_DAYS if days <= d), "all")


def absolute_url(path: str) -> str:
    """Full link without StepStone's tracking query string."""
    path = path.split("?")[0]
    return path if path.startswith("http") else f"{BASE_URL}{path}"


def parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.utcoffset() is not None else None
