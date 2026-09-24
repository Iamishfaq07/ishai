"""Safe document text extraction + chunking into retrievable facts (spec §20–§22).

All uploaded text is untrusted: we only extract plain text, never execute or follow anything in it,
and the prompt layer fences it as reference data.

Hostile files are handled in two layers:
- A DOCX is a ZIP: its central directory is inspected *before* any parser sees it (entry count, per-entry and
  total uncompressed size, compression ratio, path traversal), so a ZIP bomb is refused without inflating it.
- PDF/DOCX extraction runs in a short-lived child process (`extract_text_isolated`) with a timeout and, on Linux,
  memory and CPU limits. A parser that hangs, balloons or crashes takes down the child, never the API.
"""

import io
import logging
import multiprocessing
import re
import sys
import zipfile
from dataclasses import dataclass
from multiprocessing.connection import Connection
from pathlib import PurePosixPath

MAX_PAGES = 40
MAX_CHARS = 200_000

# DOCX archive limits (a real resume is well under 1 MB and a few dozen entries).
MAX_ZIP_ENTRIES = 1000
MAX_ZIP_ENTRY_BYTES = 25 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 50 * 1024 * 1024
MAX_ZIP_RATIO = 100  # uncompressed / compressed, checked on entries big enough to matter
ZIP_RATIO_MIN_BYTES = 1024 * 1024
# Child-process limits for PDF/DOCX extraction.
PARSE_TIMEOUT_S = 20.0
PARSE_MEMORY_BYTES = 768 * 1024 * 1024
PARSE_CPU_SECONDS = 30
# Set by `isolation_selftest()` at boot if child-process parsing doesn't work on this host; extraction then runs
# in-process (archive inspection still applies) instead of failing every upload.
ISOLATION_BROKEN = False
log = logging.getLogger(__name__)

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


def inspect_docx_archive(data: bytes) -> None:
    """Refuse ZIP bombs and odd archives from the central directory alone (nothing is decompressed here)."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError) as e:
        raise ParseError("File is not a valid DOCX.") from e
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise ParseError("This DOCX has too many parts to process safely.")
        total = 0
        names = set()
        for info in infos:
            name = info.filename
            path = PurePosixPath(name.replace("\\", "/"))
            if name.startswith(("/", "\\")) or ".." in path.parts or ":" in name:
                raise ParseError("This DOCX contains an invalid file path.")
            if info.file_size > MAX_ZIP_ENTRY_BYTES:
                raise ParseError("This DOCX is too large to process (an embedded part is over 25 MB).")
            if info.file_size >= ZIP_RATIO_MIN_BYTES and info.file_size > MAX_ZIP_RATIO * max(info.compress_size, 1):
                raise ParseError("This DOCX looks like a compression bomb and was refused.")
            total += info.file_size
            names.add(name)
        if total > MAX_ZIP_TOTAL_BYTES:
            raise ParseError("This DOCX is too large to process (over 50 MB uncompressed).")
        if "word/document.xml" not in names or "[Content_Types].xml" not in names:
            raise ParseError("File is not a valid DOCX.")


def _limit_child_resources() -> None:
    if sys.platform.startswith("linux"):
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (PARSE_MEMORY_BYTES, PARSE_MEMORY_BYTES))
        resource.setrlimit(resource.RLIMIT_CPU, (PARSE_CPU_SECONDS, PARSE_CPU_SECONDS))


def _extract_in_child(data: bytes, fmt: str, conn: Connection) -> None:
    try:
        _limit_child_resources()
        conn.send(("ok", extract_text(data, fmt)))
    except ParseError as e:
        conn.send(("error", str(e)))
    except MemoryError:
        conn.send(("error", "This document is too large to process."))
    except BaseException:
        conn.send(("error", "Could not read this document."))
    finally:
        conn.close()


def extract_text_isolated(data: bytes, fmt: str) -> str:
    """`extract_text` in a child process with a timeout (plain text needs no parser, so it stays in-process).
    Blocking: call it from a worker thread."""
    if fmt == "docx":
        inspect_docx_archive(data)
    if fmt not in ("pdf", "docx") or ISOLATION_BROKEN:
        return extract_text(data, fmt)
    ctx = multiprocessing.get_context("spawn")  # never fork a threaded server
    receiver, sender = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_extract_in_child, args=(data, fmt, sender), daemon=True)
    proc.start()
    sender.close()
    try:
        if not receiver.poll(PARSE_TIMEOUT_S):
            raise ParseError("This document took too long to process.")
        status, value = receiver.recv()
    except (EOFError, OSError) as e:  # the child died (memory/CPU limit, parser crash)
        raise ParseError("This document couldn't be processed — it may be malformed or too complex.") from e
    finally:
        proc.join(timeout=1)
        if proc.is_alive():
            proc.kill()
            proc.join(timeout=5)
        receiver.close()
    if status != "ok":
        raise ParseError(value)
    return str(value)


def isolation_selftest() -> bool:
    """Parse a tiny generated DOCX through the child process. Run once at boot (in a thread); on failure, log
    loudly and fall back to in-process parsing rather than rejecting every PDF/DOCX upload."""
    global ISOLATION_BROKEN
    try:
        import docx

        d = docx.Document()
        d.add_paragraph("orbit parser self-test")
        buf = io.BytesIO()
        d.save(buf)
        ok = "self-test" in extract_text_isolated(buf.getvalue(), "docx")
    except Exception:
        log.exception("isolated document parsing self-test crashed")
        ok = False
    if not ok:
        ISOLATION_BROKEN = True
        log.critical("isolated document parsing is unavailable on this host; parsing in-process "
                     "(archive limits still apply)")
    return ok


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
