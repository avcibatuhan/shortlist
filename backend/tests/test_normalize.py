import pytest

from shortlist.pipeline.normalize import clean_text, detect_language, optional_text


def test_clean_text_strips_html_entities_and_whitespace() -> None:
    raw = "<p>Wir suchen&nbsp;dich!</p>\n\n<ul><li>Python</li><li>C# &amp; .NET</li></ul>"

    assert clean_text(raw) == "Wir suchen dich! Python C# & .NET"


def test_clean_text_drops_script_and_style() -> None:
    assert clean_text("<style>p{}</style>Hello<script>alert(1)</script> world") == "Hello world"


def test_clean_text_trims_to_max_chars() -> None:
    assert len(clean_text("a" * 7000)) == 6000


@pytest.mark.parametrize("raw", [None, "", "   ", "<p>&nbsp;</p>", 42])
def test_optional_text_is_none_without_content(raw: object) -> None:
    assert optional_text(raw) is None


@pytest.mark.parametrize(
    ("text", "language"),
    [
        ("Wir suchen einen Softwareentwickler für unser Team in Berlin", "de"),
        ("We are looking for a software engineer to join our team", "en"),
        ("Yazılım geliştirici aranıyor", "other"),
        ("Softwareentwickler", "other"),
    ],
)
def test_detect_language(text: str, language: str) -> None:
    assert detect_language(text) == language
