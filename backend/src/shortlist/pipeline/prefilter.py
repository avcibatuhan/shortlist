"""Light prefilter (spec §6.4): drop obvious non-candidates before the LLM. Pure functions."""


def filter_reason(title: str, exclude_terms: list[str]) -> str | None:
    """Why the job is filtered out, or None to keep it. Matches terms in the title only."""
    lowered = title.lower()
    for term in exclude_terms:
        if term.strip() and term.strip().lower() in lowered:
            return f'Title contains "{term.strip()}"'
    return None
