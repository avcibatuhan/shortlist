from datetime import UTC, datetime

import pytest

from shortlist.sources.base import Search
from shortlist.sources.indeed import IndeedSource, date_posted, salary_text
from tests.conftest import load_fixture

source = IndeedSource()


def test_build_input_always_sets_limit_and_country() -> None:
    assert source.build_input(Search(keyword=".net entwickler"), 7) == {
        "country": "de",
        "title": ".net entwickler",
        "datePosted": "1",
        "limit": 7,
    }
    assert source.build_input(Search(keyword="x", location="Berlin"), 1)["location"] == "Berlin"


@pytest.mark.parametrize(
    ("days", "expected"), [(1, "1"), (2, "3"), (10, "14"), (30, ""), (None, "")]
)
def test_date_posted_maps_to_supported_windows(days: int | None, expected: str) -> None:
    assert date_posted(days) == expected


def test_normalize_fixture_item() -> None:
    job = source.normalize(load_fixture("indeed.json")[1])

    assert job is not None
    assert job.source == "indeed"
    assert job.source_job_id == "0000000000000002"
    assert job.url == "https://de.indeed.com/viewjob?jk=0000000000000002"
    assert job.title.startswith("Softwareentwickler / Fullstack Developer (m/w/d)")
    assert job.company == "Muster Controlling GmbH & Co. KG"
    assert job.location == "Berlin"
    assert job.remote == "hybrid"
    assert job.posted_at == datetime(2026, 10, 12, 12, 53, 34, 291000, tzinfo=UTC)
    assert job.employment_type == "Teilzeit, Vollzeit, Teilzeit möglich"
    assert job.salary_text == "42,300 - 75,000 EUR per year"
    assert job.description.startswith("Softwareentwickler / Fullstack Developer (m/w/d) *React")
    assert job.description_is_snippet is False
    assert job.language == "de"


def test_missing_optional_values_are_not_invented() -> None:
    job = source.normalize(load_fixture("indeed.json")[0])

    assert job is not None
    assert job.remote == "unknown"
    assert job.salary_text is None
    assert job.employment_type == "Vollzeit"


@pytest.mark.parametrize(
    ("labels", "expected"),
    [
        (["Vollzeit", "Hybrides Arbeiten"], "hybrid"),
        (["Homeoffice", "Homeoffice-Möglichkeit"], "remote"),
        (["Homeoffice-Möglichkeit"], "unknown"),
        ([], "unknown"),
    ],
)
def test_remote_comes_from_workplace_labels_only(labels: list[str], expected: str) -> None:
    item = {**load_fixture("indeed.json")[0], "attributes": dict(enumerate(labels))}

    job = source.normalize(item)

    assert job is not None
    assert job.remote == expected


def test_minimal_item() -> None:
    job = source.normalize({"key": "abc", "title": "Developer", "url": "https://de.indeed.com/x"})

    assert job is not None
    assert (job.company, job.location, job.posted_at, job.employment_type) == ("", None, None, None)
    assert job.language == "other"


@pytest.mark.parametrize(
    ("salary", "expected"),
    [
        (
            {"min": 42300, "max": 75000, "unitOfWork": "YEAR", "currencyCode": "EUR"},
            "42,300 - 75,000 EUR per year",
        ),
        ({"min": 25, "max": 25, "unitOfWork": "HOUR", "currencyCode": "EUR"}, "25 EUR per hour"),
        ({"min": None, "max": 60000, "unitOfWork": None, "currencyCode": None}, "60,000"),
        ({"min": None, "max": None, "unitOfWork": None, "currencyCode": None}, None),
        ({}, None),
    ],
)
def test_salary_text(salary: dict[str, object], expected: str | None) -> None:
    assert salary_text(salary) == expected


@pytest.mark.parametrize("missing", ["key", "title", "url"])
def test_items_without_key_title_or_url_are_skipped(missing: str) -> None:
    item = {**load_fixture("indeed.json")[0], missing: ""}

    assert source.normalize(item) is None
