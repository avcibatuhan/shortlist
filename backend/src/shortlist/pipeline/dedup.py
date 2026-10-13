"""Fingerprinting for deduplication (spec §6.3). Pure functions, no I/O."""

import hashlib
import re
import unicodedata

_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})

# (m/w/d), (w/m/d), (f/m/d), m/f/d, (m/w/x), (all genders), (gn) ...
_GENDER_TAG = re.compile(
    r"\(?\b[mwfdx]\s*/\s*[mwfdx]\s*/\s*[mwfdx]\b\)?|\(\s*(?:all genders|gn)\s*\)"
)
# Longest first so "gmbh & co. kg" is not left as "& co. kg".
_LEGAL_FORMS = re.compile(
    r"\b(?:gmbh\s*&\s*co\.?\s*kga?a?|ag\s*&\s*co\.?\s*kga?a?|gmbh|mbh|kgaa|ag|se|kg|ug|ohg|gbr"
    r"|e\.\s?v\.|a\.\s?g\.|inc\.?|ltd\.?|llc|co\.)(?![\w])"
)


# LinkedIn region wording ("Greater Munich Metropolitan Area", "Berlin Metropolitan Area").
_CITY_NOISE = re.compile(r"\b(?:greater|metropolitan|area|region|am main|bei .*)\b")
# English city names (LinkedIn) -> the folded German name used by the German job boards.
_CITY_ALIASES = {
    "munich": "muenchen",
    "cologne": "koeln",
    "nuremberg": "nuernberg",
    "hanover": "hannover",
    "brunswick": "braunschweig",
    "dusseldorf": "duesseldorf",
    "nurnberg": "nuernberg",
    "munchen": "muenchen",
    "koln": "koeln",
}


def normalize_part(text: str) -> str:
    """Lowercase, fold umlauts and accents, keep only letters and digits."""
    folded = text.lower().translate(_UMLAUTS)
    ascii_only = unicodedata.normalize("NFKD", folded).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", ascii_only).split())


def normalize_company(company: str) -> str:
    return normalize_part(_LEGAL_FORMS.sub(" ", company.lower()))


def normalize_title(title: str) -> str:
    return normalize_part(_GENDER_TAG.sub(" ", title.lower()))


def normalize_city(location: str | None) -> str:
    """City of a location, comparable across sources.

    "Berlin, Hamburg" -> "berlin" (first one), "Munich, Bavaria, Germany" -> "muenchen",
    "Greater Karlsruhe Area" -> "karlsruhe", "Frankfurt am Main" -> "frankfurt".
    """
    city = normalize_part((location or "").split(",")[0])
    city = _CITY_NOISE.sub(" ", city)
    city = " ".join(city.split())
    return _CITY_ALIASES.get(city, city)


def fingerprint(company: str, title: str, location: str | None) -> str:
    key = "|".join((normalize_company(company), normalize_title(title), normalize_city(location)))
    return hashlib.sha256(key.encode()).hexdigest()
