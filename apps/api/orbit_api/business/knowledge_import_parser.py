"""Business policy extraction: bounded plain text, with no OCR, network fetches or in-process fallback."""

import io
import json
import multiprocessing
import sys
import threading
import unicodedata
from multiprocessing.connection import Connection
from typing import Any

from orbit_api.documents.parsing import ParseError, inspect_docx_archive

MAX_BYTES = 5 * 1024 * 1024
MAX_CHARS = 20000
MAX_PAGES = 40
TIMEOUT_S = 20.0
_slots = threading.BoundedSemaphore(1)


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "".join(c for c in text if c in "\n\t" or unicodedata.category(c) not in ("Cc", "Cf")).strip()


def extract(data: bytes, fmt: str) -> dict[str, Any]:
    pages: int | None = None
    parts: list[str] = []
    if fmt == "pdf":
        from pypdf import PdfReader

        pdf = PdfReader(io.BytesIO(data))
        if pdf.is_encrypted:
            raise ParseError("Encrypted PDFs are not supported. Export an unencrypted text PDF.")
        pages = len(pdf.pages)
        if pages > MAX_PAGES:
            raise ParseError("Import at most 40 PDF pages. Split the original into smaller references.")
        for page in pdf.pages:
            text = page.extract_text() or ""
            # Do not silently omit image-only pages inside an otherwise text-based policy.
            if not text.strip():
                raise ParseError(
                    "A PDF page has no readable text. Export a text version; scanned pages need OCR first."
                )
            parts.append(text)
            if sum(len(p) for p in parts) > MAX_CHARS:
                raise ParseError("Extracted text exceeds 20,000 characters. Split this policy into smaller references.")
    elif fmt == "docx":
        from docx import Document
        from docx.table import Table

        inspect_docx_archive(data)
        doc = Document(io.BytesIO(data))
        for block in doc.iter_inner_content():
            if isinstance(block, Table):
                for row in block.rows:
                    # Merged cells may be exposed repeatedly by python-docx.
                    seen: set[Any] = set()
                    cells = []
                    for cell in row.cells:
                        if cell._tc not in seen:
                            seen.add(cell._tc)
                            cells.append(cell.text)
                    parts.append(" | ".join(cells))
            else:
                parts.append(block.text)
            if sum(len(p) for p in parts) > MAX_CHARS:
                raise ParseError("Extracted text exceeds 20,000 characters. Split this policy into smaller references.")
    else:
        parts.append(data.decode("utf-8-sig", errors="strict"))
    text = clean_text("\n".join(parts))
    if len(text) < 50:
        raise ParseError("At least 50 readable characters are required. Export a text-based policy and try again.")
    if len(text) > MAX_CHARS:
        raise ParseError("Extracted text exceeds 20,000 characters. Split this policy into smaller references.")
    return {"text": text, "pages": pages}


def _worker(data: bytes, fmt: str, sender: Connection) -> None:
    try:
        if sys.platform.startswith("linux"):
            import resource

            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        result = {"ok": True, **extract(data, fmt)}
    except (ParseError, UnicodeDecodeError) as exc:
        result = {"ok": False, "error": str(exc)}
    except BaseException:
        result = {"ok": False, "error": "Could not extract this document. Export a simpler text version."}
    try:
        sender.send_bytes(json.dumps(result).encode())
    finally:
        sender.close()


def parse(data: bytes, fmt: str) -> dict[str, Any]:
    if fmt in ("txt", "md"):
        return extract(data, fmt)
    if fmt == "docx":
        inspect_docx_archive(data)
    if not _slots.acquire(timeout=2):
        raise ParseError("Another policy import is being processed. Try again shortly.")
    receiver = sender = proc = None
    try:
        ctx = multiprocessing.get_context("spawn")
        receiver, sender = ctx.Pipe(duplex=False)
        proc = ctx.Process(target=_worker, args=(data, fmt, sender), daemon=True)
        proc.start()
        sender.close()
        if not receiver.poll(TIMEOUT_S):
            raise ParseError("Document extraction timed out. Export a simpler text version.")
        result = json.loads(receiver.recv_bytes(300000))
        if not isinstance(result, dict):
            raise ParseError("Document extraction returned an invalid result.")
        if result.get("ok") is not True:
            raise ParseError(result.get("error", "Could not extract this document."))
        text, pages = result.get("text"), result.get("pages")
        if not isinstance(text, str) or not 50 <= len(text) <= MAX_CHARS:
            raise ParseError("Document extraction returned invalid text.")
        if (fmt == "pdf" and (type(pages) is not int or not 1 <= pages <= MAX_PAGES)) or (
            fmt == "docx" and pages is not None
        ):
            raise ParseError("Document extraction returned an invalid page count.")
        return {"text": text, "pages": pages}
    except (EOFError, OSError, RuntimeError, RecursionError, ValueError, TypeError, KeyError) as exc:
        if isinstance(exc, ParseError):
            raise
        raise ParseError("Could not extract this document. Export a simpler text version.") from exc
    finally:
        if proc is not None and proc.pid is not None:
            proc.join(timeout=0.2)
            if proc.is_alive():
                proc.kill()
                proc.join(timeout=2)
        if receiver is not None:
            receiver.close()
        if sender is not None:
            sender.close()
        _slots.release()
