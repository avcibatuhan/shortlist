import pytest

from shortlist.pipeline.prefilter import filter_reason

TERMS = ["Werkstudent", "Praktikum", "Ausbildung", "Duales Studium"]


@pytest.mark.parametrize(
    ("title", "term"),
    [
        ("Werkstudent Softwareentwicklung (m/w/d)", "Werkstudent"),
        ("WERKSTUDENTIN im Bereich KI", "Werkstudent"),
        ("Praktikum Softwareentwicklung", "Praktikum"),
        ("Duales Studium Informatik 2027", "Duales Studium"),
    ],
)
def test_title_with_exclude_term_is_filtered(title: str, term: str) -> None:
    assert filter_reason(title, TERMS) == f'Title contains "{term}"'


@pytest.mark.parametrize("title", ["Softwareentwickler (m/w/d)", "Ausbilder für Informatik"])
def test_other_titles_are_kept(title: str) -> None:
    assert filter_reason(title, TERMS) is None


def test_no_terms_means_no_filter() -> None:
    assert filter_reason("Werkstudent", []) is None
    assert filter_reason("Werkstudent", ["", "  "]) is None
