from shortlist.sources.base import Source
from shortlist.sources.indeed import IndeedSource
from shortlist.sources.linkedin import LinkedInSource
from shortlist.sources.stepstone import StepStoneSource

SOURCES: dict[str, Source] = {
    source.name: source for source in (LinkedInSource(), IndeedSource(), StepStoneSource())
}
