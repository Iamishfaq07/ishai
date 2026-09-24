"""Hostile uploads: ZIP/DOCX bombs, odd archives, malformed PDFs, and parser isolation (timeout, crash)."""

import io
import uuid
import zipfile

import pytest
from fastapi.testclient import TestClient

from orbit_api.documents import parsing
from orbit_api.documents.parsing import ParseError, extract_text_isolated, inspect_docx_archive


def _docx(text: str = "Security Engineer at Acme. Led the AppSec program.") -> bytes:
    import docx

    d = docx.Document()
    d.add_paragraph(text)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _rezip(base: bytes, extra: dict[str, bytes] | None = None, drop: set[str] | None = None) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base)) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            if drop and info.filename in drop:
                continue
            dst.writestr(info, src.read(info.filename))
        for name, data in (extra or {}).items():
            dst.writestr(name, data)
    return out.getvalue()


def test_real_docx_extracts_through_the_isolated_parser() -> None:
    assert "Led the AppSec program" in extract_text_isolated(_docx(), "docx")


def test_compression_bomb_is_refused_without_inflating() -> None:
    bomb = _rezip(_docx(), {"word/media/zeros.bin": b"\0" * (3 * 1024 * 1024)})  # ~1000:1
    with pytest.raises(ParseError, match="compression bomb"):
        inspect_docx_archive(bomb)


def test_oversized_and_too_many_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parsing, "MAX_ZIP_ENTRY_BYTES", 10_000)
    with pytest.raises(ParseError, match="over 25 MB"):
        inspect_docx_archive(_rezip(_docx(), {"word/media/big.bin": bytes(range(256)) * 100}))
    monkeypatch.setattr(parsing, "MAX_ZIP_ENTRY_BYTES", 25 * 1024 * 1024)
    monkeypatch.setattr(parsing, "MAX_ZIP_TOTAL_BYTES", 20_000)
    with pytest.raises(ParseError, match="uncompressed"):
        inspect_docx_archive(_rezip(_docx(), {f"word/media/{i}.bin": bytes(range(256)) * 20 for i in range(10)}))
    monkeypatch.setattr(parsing, "MAX_ZIP_TOTAL_BYTES", 50 * 1024 * 1024)
    monkeypatch.setattr(parsing, "MAX_ZIP_ENTRIES", 12)
    with pytest.raises(ParseError, match="too many parts"):
        inspect_docx_archive(_rezip(_docx(), {f"word/x{i}.xml": b"<x/>" for i in range(20)}))


@pytest.mark.parametrize("name", ["../../evil.xml", "/etc/passwd", "word/../../x.xml", "C:/Windows/x.xml"])
def test_path_traversal_entries_are_refused(name: str) -> None:
    with pytest.raises(ParseError, match="invalid file path"):
        inspect_docx_archive(_rezip(_docx(), {name: b"<x/>"}))


def test_archive_that_is_not_a_docx() -> None:
    with pytest.raises(ParseError, match="not a valid DOCX"):
        inspect_docx_archive(_rezip(_docx(), drop={"word/document.xml"}))
    with pytest.raises(ParseError, match="not a valid DOCX"):
        extract_text_isolated(b"PK\x03\x04" + b"garbage" * 50, "docx")


def test_malformed_pdf_fails_cleanly_in_the_child() -> None:
    with pytest.raises(ParseError):
        extract_text_isolated(b"%PDF-1.7\n" + b"\x00\xff" * 4000 + b"\n%%EOF", "pdf")


def test_parser_timeout_kills_the_child(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parsing, "PARSE_TIMEOUT_S", 0.001)  # spawning alone takes longer
    with pytest.raises(ParseError, match="too long"):
        extract_text_isolated(_docx(), "docx")


def test_plain_text_skips_the_child() -> None:
    assert extract_text_isolated(b"just notes", "txt") == "just notes"


def test_bomb_upload_is_rejected_by_the_api(client: TestClient) -> None:
    r = client.post("/v1/auth/register", json={"email": f"up-{uuid.uuid4().hex[:8]}@example.com",
                                               "password": "upload hardening 1"})
    client.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    bomb = _rezip(_docx(), {"word/media/zeros.bin": b"\0" * (3 * 1024 * 1024)})
    up = client.post("/v1/documents", headers=h, data={"kind": "resume"},
                     files={"file": ("resume.docx", bomb, "application/octet-stream")})
    assert up.status_code in (400, 422) and "compression bomb" in up.text
    ok = client.post("/v1/documents", headers=h, data={"kind": "resume"},
                     files={"file": ("resume.docx", _docx(), "application/octet-stream")})
    assert ok.status_code == 201, ok.text


def test_boot_selftest_and_degraded_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    assert parsing.isolation_selftest() is True and parsing.ISOLATION_BROKEN is False
    # a host where child processes don't work: uploads keep working in-process, and bombs are still refused
    monkeypatch.setattr(parsing, "ISOLATION_BROKEN", True)
    assert "Led the AppSec program" in extract_text_isolated(_docx(), "docx")
    with pytest.raises(ParseError, match="compression bomb"):
        extract_text_isolated(_rezip(_docx(), {"word/media/zeros.bin": b"\0" * (3 * 1024 * 1024)}), "docx")