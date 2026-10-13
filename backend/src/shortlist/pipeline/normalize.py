"""Text helpers shared by the source adapters. Pure functions, no I/O."""

import re
from html.parser import HTMLParser

MAX_DESCRIPTION_CHARS = 6000

_BLOCK_TAGS = frozenset(
    {"p", "br", "li", "ul", "ol", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section"}
)
_SKIPPED_TAGS = frozenset({"script", "style"})

_GERMAN_WORDS = frozenset(
    [
        "der",
        "die",
        "das",
        "und",
        "wir",
        "für",
        "mit",
        "sie",
        "ist",
        "ein",
        "eine",
        "einen",
        "zur",
        "zum",
        "den",
        "dem",
        "im",
        "von",
        "unser",
        "unsere",
        "unseres",
        "suchen",
        "bei",
        "als",
        "auf",
        "nicht",
        "sich",
        "oder",
        "wie",
        "auch",
        "werden",
        "du",
        "dich",
        "deine",
        "ihre",
        "ihr",
    ]
)
_ENGLISH_WORDS = frozenset(
    [
        "the",
        "and",
        "we",
        "for",
        "with",
        "you",
        "is",
        "are",
        "our",
        "to",
        "of",
        "as",
        "on",
        "your",
        "will",
        "be",
        "an",
        "or",
        "this",
        "that",
        "have",
        "at",
        "from",
        "by",
        "looking",
        "join",
        "team",
        "who",
    ]
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BLOCK_TAGS:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self.parts.append(data)


def clean_text(raw: str | None, max_chars: int = MAX_DESCRIPTION_CHARS) -> str:
    """Strip HTML tags and entities, collapse whitespace, trim to `max_chars`."""
    if not raw:
        return ""
    parser = _TextExtractor()
    parser.feed(raw)
    parser.close()
    text = " ".join("".join(parser.parts).split())
    return text[:max_chars].rstrip()


def optional_text(raw: object) -> str | None:
    """A cleaned string, or None when the source gave nothing usable."""
    if not isinstance(raw, str):
        return None
    return clean_text(raw) or None


def detect_language(text: str) -> str:
    """`de`, `en` or `other`, by counting common function words. Unsure means `other`."""
    words = re.findall(r"[a-zäöüß]+", text.lower())
    german = sum(word in _GERMAN_WORDS for word in words)
    english = sum(word in _ENGLISH_WORDS for word in words)
    if max(german, english) < 2 or german == english:
        return "other"
    return "de" if german > english else "en"
