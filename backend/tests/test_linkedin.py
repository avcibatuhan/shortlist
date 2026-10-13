from datetime import UTC, datetime

import pytest

from shortlist.sources.base import Search
from shortlist.sources.linkedin import LinkedInSource, date_posted
from tests.conftest import load_fixture

source = LinkedInSource()


def test_build_input_always_sets_limit() -> None:
    run_input = source.build_input(Search(keyword=".NET developer", location="Germany"), 7)

    assert run_input == {
        "keywords": ".NET developer",
        "location": "Germany",
        "datePosted": "past24Hours",
        "limitPerSource": 7,
        "scrapeCompany": False,
    }


@pytest.mark.parametrize(
    ("days", "expected"),
    [(1, "past24Hours"), (3, "pastWeek"), (7, "pastWeek"), (30, "pastMonth"), (60, "anyTime")],
)
def test_date_posted_maps_to_supported_windows(days: int, expected: str) -> None:
    assert date_posted(days) == expected
    assert date_posted(None) == "anyTime"


def test_normalize_fixture_item() -> None:
    job = source.normalize(load_fixture("linkedin.json")[0])

    assert job is not None
    assert job.source == "linkedin"
    assert job.source_job_id == "4000000001"
    assert job.url == (
        "https://de.linkedin.com/jobs/view/java-software-developer-w-m-d-communication-platform"
        "-at-example-hosting-4000000001"
    )
    assert job.title == "Java Software Developer (w/m/d) Communication Platform"
    assert job.company == "Example Hosting"
    assert job.location == "Greater Karlsruhe Area"
    assert job.remote == "unknown"
    assert job.posted_at == datetime(2026, 10, 12, tzinfo=UTC)
    assert job.employment_type == "Full-time"
    assert job.salary_text is None
    assert job.description.startswith("Über uns Wir entwickeln")
    assert job.description_is_snippet is False
    assert job.language == "de"


def test_normalize_all_fixture_items() -> None:
    jobs = [source.normalize(item) for item in load_fixture("linkedin.json")]

    assert [job.language for job in jobs if job] == ["de", "de", "en", "en"]


def test_description_falls_back_to_html() -> None:
    item = {**load_fixture("linkedin.json")[0], "descriptionText": ""}

    job = source.normalize(item)

    assert job is not None
    assert job.description.startswith("Über uns Wir entwickeln")
    assert "<" not in job.description


@pytest.mark.parametrize("missing", ["id", "title", "link"])
def test_items_without_id_title_or_link_are_skipped(missing: str) -> None:
    item = {**load_fixture("linkedin.json")[0], missing: ""}

    assert source.normalize(item) is None
