from datetime import UTC, datetime

import pytest

from shortlist.sources.base import Search
from shortlist.sources.stepstone import StepStoneSource, posted_within
from tests.conftest import load_fixture

source = StepStoneSource()


def test_build_input_always_sets_limit_and_disables_paid_extras() -> None:
    run_input = source.build_input(Search(keyword=".net entwickler", location="berlin"), 7)

    assert run_input == {
        "keyword": ".net entwickler",
        "location": "berlin",
        "country": "de",
        "postedWithin": "1",
        "includeRelatedJobs": False,
        "enrichEmails": False,
        "maxItems": 7,
    }


@pytest.mark.parametrize(
    ("days", "expected"), [(1, "1"), (2, "3"), (7, "7"), (14, "all"), (None, "all")]
)
def test_posted_within_maps_to_supported_windows(days: int | None, expected: str) -> None:
    assert posted_within(days) == expected


def test_normalize_fixture_item() -> None:
    job = source.normalize(load_fixture("stepstone.json")[0])

    assert job is not None
    assert job.source == "stepstone"
    assert job.source_job_id == "10000001"
    assert job.title == "Softwareentwickler (m/w/d)"
    assert job.company == "Beispiel Maschinenbau GmbH"
    assert job.location == "Bad Musterstadt bei Karlsruhe"
    assert job.remote == "hybrid"
    assert job.posted_at == datetime(2026, 10, 12, 8, 46, 10, tzinfo=UTC)
    assert job.employment_type is None
    assert job.salary_text is None
    assert job.description.startswith("Zur Verstärkung unseres Engineering-Teams")
    assert "&nbsp;" not in job.description
    assert "\n" not in job.description
    assert job.description_is_snippet is True
    assert job.language == "de"
    assert job.url == (
        "https://www.stepstone.de/jobs--Softwareentwickler-m-w-d-Bad-Musterstadt-bei-Karlsruhe"
        "-Beispiel-Maschinenbau-GmbH--10000001-inline.html"
    )


def test_normalize_all_fixture_items() -> None:
    jobs = [source.normalize(item) for item in load_fixture("stepstone.json")]

    assert all(job is not None for job in jobs)
    assert [job.language for job in jobs if job] == ["de", "de", "en", "en", "en"]
    assert [job.remote for job in jobs if job] == [
        "hybrid",
        "hybrid",
        "unknown",
        "unknown",
        "hybrid",
    ]


def test_unknown_values_are_not_invented() -> None:
    job = source.normalize(
        {"id": 1, "title": "Developer", "url": "/jobs--x-1-inline.html", "workFromHome": "1"}
    )

    assert job is not None
    assert job.company == ""
    assert job.location is None
    assert job.remote == "unknown"
    assert job.posted_at is None
    assert job.description == ""


@pytest.mark.parametrize(
    "item",
    [
        {"title": "Developer", "url": "/jobs--x-1-inline.html"},
        {"id": 1, "url": "/jobs--x-1-inline.html"},
        {"id": 1, "title": "Developer"},
    ],
)
def test_items_without_id_title_or_url_are_skipped(item: dict[str, object]) -> None:
    assert source.normalize(item) is None
