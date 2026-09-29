"""PDFs the first reader can't handle: PDFium when pypdf fails, OCR when there's no text layer (a scan)."""

import io

import pytest
from PIL import Image, ImageDraw, ImageFont

from orbit_api.documents import parsing
from orbit_api.documents.parsing import ParseError, extract_text, extract_text_isolated

LINES = ["Jane Doe", "Senior Software Engineer", "Experience", "Built payment systems at Acme Corp",
         "Skills: Python, Kubernetes, PostgreSQL"]


def _scanned_pdf() -> bytes:
    """A page that is only a picture of text, like a scanner or a phone camera makes."""
    img = Image.new("L", (1275, 1650), 255)  # US Letter at 150 dpi
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=36)
    for i, line in enumerate(LINES):
        draw.text((120, 150 + i * 80), line, fill=0, font=font)
    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=150)
    return buf.getvalue()


def _text_pdf() -> bytes:
    """A one-page PDF with a real text layer."""
    stream = b"BT /F1 14 Tf 72 700 Td (Jane Doe, Senior Software Engineer) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def test_pdfium_reads_what_pypdf_cannot(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(_: bytes) -> str:
        raise ValueError("pypdf gave up")

    monkeypatch.setattr(parsing, "_pypdf_text", broken)
    assert "Senior Software Engineer" in extract_text(_text_pdf(), "pdf")


@pytest.mark.skipif(not parsing.ocr_available(), reason="tesseract isn't installed")
def test_a_scanned_resume_is_read_with_ocr() -> None:
    text = extract_text_isolated(_scanned_pdf(), "pdf")
    for words in ("Jane Doe", "Software Engineer", "Acme Corp", "Kubernetes"):
        assert words in text


def test_a_scan_without_ocr_says_what_to_do(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parsing.shutil, "which", lambda _: None)
    with pytest.raises(ParseError, match="scanned image"):
        extract_text(_scanned_pdf(), "pdf")
