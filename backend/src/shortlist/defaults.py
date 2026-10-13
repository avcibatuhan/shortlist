"""Initial owner settings, used to create the Settings row on first use (editable later)."""

import json

from shortlist.models import Settings
from shortlist.sources.base import Search

# An example profile. The owner replaces it in Settings with their own; whatever limits the
# decision (languages, permits, where they can work) belongs there, not in the code.
PROFILE_TEXT = """\
- Software engineer, about 3 years of experience with C#/.NET (ASP.NET Core, EF Core, SQL Server), React/TypeScript and Python
- Background in manufacturing software and system integration (REST APIs, ERP)
- MSc in Artificial Intelligence: computer vision and LLM integration
- Based in Germany; works in German and English
- Target roles: Software Developer (.NET / Fullstack), AI Engineer / AI Developer (Python), IT Support (fallback)
"""  # noqa: E501

# Narrow searches first: results a search does not use are passed on to the next one.
# All searches look at the last day only, so a daily run does not pay for old jobs again.
SEARCHES: dict[str, list[Search]] = {
    "linkedin": [
        Search(keyword=".NET developer", location="Germany"),
        Search(keyword="AI engineer", location="Germany"),
        Search(keyword="software developer", location="Germany"),
    ],
    "indeed": [  # no location = all of Germany
        Search(keyword=".net entwickler"),
        Search(keyword="ai engineer"),
        Search(keyword="softwareentwickler"),
    ],
    "stepstone": [
        Search(keyword=".net entwickler", location="deutschland"),
        Search(keyword="ai engineer", location="deutschland"),
        Search(keyword="softwareentwickler", location="deutschland"),
    ],
}
# Per-source result limit preselected on the Run page until the owner sets one in Settings.
# Kept small on purpose (the spec's daily default is 50): every result is billed.
DEFAULT_LIMIT = 5
EXCLUDE_TERMS = ["Werkstudent", "Praktikum", "Ausbildung", "Duales Studium"]
MONTHLY_BUDGET_USD = 10.0
# Chosen by the owner on 2026-10-13 (see docs/decisions.md). Any installed Ollama model can
# be picked in the dashboard.
MODEL_NAME = "gemma4:12b-it-qat"


def default_settings() -> Settings:
    return Settings(
        id=1,
        profile_text=PROFILE_TEXT,
        searches_json=json.dumps(
            {source: [s.model_dump() for s in searches] for source, searches in SEARCHES.items()}
        ),
        exclude_terms_json=json.dumps(EXCLUDE_TERMS),
        monthly_budget_usd=MONTHLY_BUDGET_USD,
        model_name=MODEL_NAME,
    )
