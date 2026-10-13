import pytest

from shortlist.pipeline.dedup import (
    fingerprint,
    normalize_city,
    normalize_company,
    normalize_title,
)


@pytest.mark.parametrize(
    ("company", "expected"),
    [
        ("Müller Maschinenbau GmbH & Co. KG", "mueller maschinenbau"),
        ("Example AG", "example"),
        ("Example Services SE", "example services"),
        ("Muster Versicherung a.G.", "muster versicherung"),
        ("Société Générale", "societe generale"),
        ("Agile Segment", "agile segment"),  # "ag" / "se" inside words stay
    ],
)
def test_normalize_company(company: str, expected: str) -> None:
    assert normalize_company(company) == expected


@pytest.mark.parametrize(
    "title",
    [
        "Softwareentwickler (m/w/d)",
        "Softwareentwickler (w/m/d)",
        "Softwareentwickler m/f/d",
        "Softwareentwickler (f/m/x)",
        "Softwareentwickler (all genders)",
        "SOFTWAREENTWICKLER (gn)",
    ],
)
def test_normalize_title_removes_gender_tags(title: str) -> None:
    assert normalize_title(title) == "softwareentwickler"


def test_normalize_title_keeps_the_rest() -> None:
    assert normalize_title("Senior C# / .NET Entwickler (m/w/d) – Backend") == (
        "senior c net entwickler backend"
    )


def test_normalize_city_uses_first_location() -> None:
    assert normalize_city("Düsseldorf, Köln") == "duesseldorf"
    assert normalize_city(None) == ""


@pytest.mark.parametrize(
    ("location", "city"),
    [
        ("Munich, Bavaria, Germany", "muenchen"),  # LinkedIn
        ("München", "muenchen"),  # StepStone / Indeed
        ("Greater Karlsruhe Area", "karlsruhe"),
        ("Karlsruhe, Baden-Württemberg, Germany", "karlsruhe"),
        ("Berlin Metropolitan Area", "berlin"),
        ("Frankfurt am Main, Hesse, Germany", "frankfurt"),
        ("Dusseldorf, North Rhine-Westphalia, Germany", "duesseldorf"),
        ("Bad Schönborn bei Karlsruhe", "bad schoenborn"),
    ],
)
def test_normalize_city_is_comparable_across_sources(location: str, city: str) -> None:
    assert normalize_city(location) == city


def test_same_job_from_different_sources_has_one_fingerprint() -> None:
    a = fingerprint("Müller GmbH", "Softwareentwickler (m/w/d)", "München")
    b = fingerprint("MUELLER GMBH & Co. KG", "Softwareentwickler m/f/d", "Muenchen, Bayern")

    assert a == b


def test_different_city_is_a_different_job() -> None:
    assert fingerprint("Müller GmbH", "Entwickler", "Berlin") != fingerprint(
        "Müller GmbH", "Entwickler", "Hamburg"
    )
