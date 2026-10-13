"""Cover letter as a one-page A4 PDF."""

import re
from datetime import date
from pathlib import Path

from fpdf import FPDF

FONT_DIR = Path(__file__).parent / "assets" / "fonts"
FONT = "LiberationSans"  # bundled (SIL Open Font License): covers names beyond Latin-1

MARGIN_MM = 25
BODY_PT = 11
LINE_MM = 5.6
PARAGRAPH_GAP_MM = 3.2

MONTHS = {
    "de": [
        "Januar",
        "Februar",
        "März",
        "April",
        "Mai",
        "Juni",
        "Juli",
        "August",
        "September",
        "Oktober",
        "November",
        "Dezember",
    ],
    "en": [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ],
}
_SUBJECT_PREFIX = re.compile(r"^(?:subject|betreff)\s*:\s*", re.IGNORECASE)
_SUBJECT = re.compile(r"^(?:bewerbung|application)\b", re.IGNORECASE)


def format_date(day: date, language: str) -> str:
    """ "13. Oktober 2026" in German, "13 October 2026" otherwise."""
    months = MONTHS.get(language, MONTHS["en"])
    separator = ". " if language == "de" else " "
    return f"{day.day}{separator}{months[day.month - 1]} {day.year}"


def split_subject(text: str) -> tuple[str | None, str]:
    """The subject line of the letter, if its first line is one, and the rest."""
    first, _, rest = text.strip().partition("\n")
    stripped = _SUBJECT_PREFIX.sub("", first.strip())
    if stripped != first.strip() or _SUBJECT.match(stripped):
        return stripped, rest.strip()
    return None, text.strip()


def letter_pdf(text: str, name: str, language: str, today: date) -> bytes:
    """Lay the letter out on A4: sender, date, subject in bold, then the paragraphs."""
    pdf = FPDF(format="A4", unit="mm")
    pdf.set_margins(MARGIN_MM, MARGIN_MM, MARGIN_MM)
    pdf.set_auto_page_break(auto=True, margin=MARGIN_MM)
    pdf.add_font(FONT, "", str(FONT_DIR / "LiberationSans-Regular.ttf"))
    pdf.add_font(FONT, "B", str(FONT_DIR / "LiberationSans-Bold.ttf"))
    pdf.set_title("Anschreiben" if language == "de" else "Cover letter")
    if name:
        pdf.set_author(name)
    pdf.add_page()

    if name:
        pdf.set_font(FONT, "B", BODY_PT)
        pdf.cell(0, LINE_MM, name, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(FONT, "", BODY_PT)
    pdf.cell(0, LINE_MM, format_date(today, language), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(LINE_MM * 2)

    subject, body = split_subject(text)
    if subject:
        pdf.set_font(FONT, "B", BODY_PT + 1)
        pdf.multi_cell(0, LINE_MM + 0.6, subject, align="L", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(LINE_MM)
        pdf.set_font(FONT, "", BODY_PT)

    for line in body.split("\n"):
        if line.strip():
            pdf.multi_cell(0, LINE_MM, line.strip(), align="L", new_x="LMARGIN", new_y="NEXT")
        else:
            pdf.ln(PARAGRAPH_GAP_MM)
    return bytes(pdf.output())


def letter_filename(language: str, company: str) -> str:
    """ASCII file name such as "Anschreiben-Beispiel-GmbH.pdf"."""
    umlauts: dict[str, str | int | None] = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}
    folded = company.translate(str.maketrans(umlauts))
    slug = re.sub(r"[^A-Za-z0-9]+", "-", folded).strip("-")[:60]
    prefix = "Anschreiben" if language == "de" else "Cover-letter"
    return f"{prefix}-{slug}.pdf" if slug else f"{prefix}.pdf"
