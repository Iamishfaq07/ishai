"""Safe document text extraction + chunking into retrievable facts (spec §20–§22).

All uploaded text is untrusted: we only extract plain text, never execute or follow anything in it,
and the prompt layer fences it as reference data.
"""

import io
import re
from dataclasses import dataclass

MAX_PAGES = 40
MAX_CHARS = 200_000

ALLOWED_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "md",
}
ALLOWED_EXT = {".pdf": "pdf", ".docx": "docx", ".txt": "txt", ".md": "md"}


class ParseError(ValueError):
    pass


def detect_format(filename: str, content_type: str | None, head: bytes) -> str:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    fmt = ALLOWED_EXT.get(ext) or ALLOWED_TYPES.get((content_type or "").split(";")[0].strip())
    if fmt is None:
        raise ParseError("Unsupported file type. Upload PDF, DOCX, TXT or MD.")
    # Magic-byte check so a renamed binary can't masquerade as another format.
    if fmt == "pdf" and not head.startswith(b"%PDF"):
        raise ParseError("File is not a valid PDF.")
    if fmt == "docx" and not head.startswith(b"PK"):
        raise ParseError("File is not a valid DOCX.")
    if fmt in ("txt", "md") and b"\x00" in head:
        raise ParseError("Text file contains binary data.")
    return fmt


def extract_text(data: bytes, fmt: str) -> str:
    try:
        if fmt == "pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ParseError("Encrypted PDFs are not supported.")
            text = "\n".join((p.extract_text() or "") for p in reader.pages[:MAX_PAGES])
        elif fmt == "docx":
            import docx

            d = docx.Document(io.BytesIO(data))
            text = "\n".join(p.text for p in d.paragraphs)
        else:
            text = data.decode("utf-8", errors="replace")
    except ParseError:
        raise
    except Exception as e:
        raise ParseError("Could not read this document.") from e
    text = text.replace("\r\n", "\n").replace("\x00", "")
    if not text.strip():
        raise ParseError("No readable text found (scanned PDFs need OCR, not yet supported).")
    return text[:MAX_CHARS]


@dataclass
class ChunkDraft:
    category: str
    label: str
    text: str
    verified: bool


_RESUME_SECTIONS: list[tuple[str, tuple[str, ...]]] = [
    ("summary", ("summary", "profile", "about", "objective")),
    ("experience", ("experience", "employment", "work history", "professional experience", "career")),
    ("project", ("projects", "selected projects", "portfolio")),
    ("skill", ("skills", "technical skills", "technologies", "tools", "core competencies")),
    ("education", ("education", "academic")),
    ("certification", ("certifications", "certificates", "licenses")),
    ("achievement", ("achievements", "awards", "honors", "publications")),
]
_JD_SECTIONS: list[tuple[str, tuple[str, ...]]] = [
    ("company", ("about us", "about the company", "who we are", "our mission", "about the team")),
    ("responsibility", ("responsibilities", "what you'll do", "what you will do", "the role", "your role")),
    ("requirement", ("requirements", "qualifications", "what you bring", "must have", "you have",
                     "what we're looking for", "preferred", "nice to have", "skills")),
]
_BULLET = re.compile(r"^\s*(?:[-*•▪◦·]|\d+[.)])\s*")


def _section_of(line: str, table: list[tuple[str, tuple[str, ...]]]) -> str | None:
    norm = re.sub(r"[^a-z' ]", "", line.lower()).strip()
    if not norm or len(norm) > 40:
        return None
    for cat, names in table:
        if norm in names:
            return cat
    return None


def _structured_chunks(
    text: str, table: list[tuple[str, tuple[str, ...]]], default: str, verified: bool, label_prefix: str
) -> list[ChunkDraft]:
    chunks: list[ChunkDraft] = []
    section = default
    heading = ""  # current employer/role line inside experience
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        sec = _section_of(line, table)
        if sec:
            section, heading = sec, ""
            continue
        is_bullet = bool(_BULLET.match(raw))
        body = _BULLET.sub("", line).strip()
        if len(body) < 3:
            continue
        if not is_bullet and len(body) <= 90 and section in ("experience", "project"):
            heading = body  # e.g. "Security Engineer — Acme Corp (2021–2024)"
            continue
        full = f"{heading}: {body}" if heading else body
        label = f"{label_prefix}: {(heading or section.title())[:80]}"
        chunks.append(ChunkDraft(section, label, full[:1200], verified))
    return chunks


def _excerpt_chunks(text: str, label_prefix: str, size: int = 700) -> list[ChunkDraft]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[ChunkDraft] = []
    buf = ""
    for p in paras:
        if len(buf) + len(p) > size and buf:
            chunks.append(ChunkDraft("excerpt", f"{label_prefix}: {buf[:50]}…", buf, False))
            buf = ""
        buf = f"{buf}\n\n{p}".strip()
    if buf:
        chunks.append(ChunkDraft("excerpt", f"{label_prefix}: {buf[:50]}…", buf, False))
    return chunks


def chunk_document(text: str, kind: str, title: str) -> list[ChunkDraft]:
    if kind == "resume":
        return _structured_chunks(text, _RESUME_SECTIONS, "summary", verified=True, label_prefix="resume")
    if kind == "job_description":
        return _structured_chunks(text, _JD_SECTIONS, "requirement", verified=False, label_prefix="JD")
    return _excerpt_chunks(text, label_prefix=title[:40])
