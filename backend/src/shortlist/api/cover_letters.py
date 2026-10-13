from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from shortlist.db import SessionDep
from shortlist.llm.cover_letter import MAX_WORDS, count_words, sign, write_cover_letter
from shortlist.llm.ollama_client import LLMClient, LLMUnavailable
from shortlist.models import CoverLetter, Job
from shortlist.owner_settings import get_settings
from shortlist.pdf import letter_filename, letter_pdf
from shortlist.pipeline.match import job_text

router = APIRouter(prefix="/jobs", tags=["cover letters"])


class CoverLetterOut(BaseModel):
    job_id: int
    language: Literal["de", "en"]
    text: str
    words: int
    too_long: bool  # more than one page (350 words)
    edited: bool  # changed by the owner after it was written
    model: str
    latency_ms: int
    updated_at: datetime


class CoverLetterEdit(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


def letter_out(letter: CoverLetter) -> CoverLetterOut:
    words = count_words(letter.text)
    return CoverLetterOut.model_validate(
        {**letter.model_dump(), "words": words, "too_long": words > MAX_WORDS}
    )


def job_or_404(session: Session, job_id: int) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


def stored_letter(session: Session, job_id: int) -> CoverLetter | None:
    return session.exec(select(CoverLetter).where(CoverLetter.job_id == job_id)).first()


@router.get("/{job_id}/cover-letter", responses={404: {}})
def read_cover_letter(job_id: int, session: SessionDep) -> CoverLetterOut:
    job_or_404(session, job_id)
    letter = stored_letter(session, job_id)
    if letter is None:
        raise HTTPException(404, "No cover letter has been written for this job yet.")
    return letter_out(letter)


@router.post("/{job_id}/cover-letter", responses={404: {}, 503: {}})
async def create_cover_letter(job_id: int, request: Request, session: SessionDep) -> CoverLetterOut:
    """Let the LLM write a cover letter for this job, in the language of the posting.

    Replaces an earlier letter for the job. It is a draft: the owner edits it before sending.
    """
    job = job_or_404(session, job_id)
    settings = get_settings(session)
    llm: LLMClient = request.app.state.llm
    try:
        written = await write_cover_letter(
            llm,
            settings.model_name,
            settings.profile_text,
            job_text(job),
            job.language,
            settings.full_name,
        )
    except LLMUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    if not written.text:
        raise HTTPException(503, "The model returned an empty letter. Try again.")

    now = datetime.now(UTC)
    letter = stored_letter(session, job_id) or CoverLetter(
        job_id=job_id,
        language=written.language,
        text="",
        model=settings.model_name,
        latency_ms=0,
        created_at=now,
        updated_at=now,
    )
    letter.language = written.language
    letter.text = written.text
    letter.edited = False
    letter.model = settings.model_name
    letter.latency_ms = written.latency_ms
    letter.updated_at = now
    session.add(letter)
    session.commit()
    session.refresh(letter)
    return letter_out(letter)


@router.put("/{job_id}/cover-letter", responses={404: {}})
def edit_cover_letter(job_id: int, body: CoverLetterEdit, session: SessionDep) -> CoverLetterOut:
    """Save the owner's edited version of the letter."""
    job_or_404(session, job_id)
    letter = stored_letter(session, job_id)
    if letter is None:
        raise HTTPException(404, "No cover letter has been written for this job yet.")
    text = body.text.strip()
    if text != letter.text:
        letter.text = text
        letter.edited = True
        letter.updated_at = datetime.now(UTC)
        session.add(letter)
        session.commit()
        session.refresh(letter)
    return letter_out(letter)


@router.get(
    "/{job_id}/cover-letter/pdf",
    responses={200: {"content": {"application/pdf": {}}}, 404: {}},
    response_class=Response,
)
def download_cover_letter(job_id: int, session: SessionDep) -> Response:
    """The saved letter as an A4 PDF, signed with the name from Settings."""
    job = job_or_404(session, job_id)
    letter = stored_letter(session, job_id)
    if letter is None:
        raise HTTPException(404, "No cover letter has been written for this job yet.")
    name = get_settings(session).full_name.strip()
    # Letters written before the name was set still carry a placeholder.
    pdf = letter_pdf(sign(letter.text, name), name, letter.language, datetime.now(UTC).date())
    filename = letter_filename(letter.language, job.company)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
