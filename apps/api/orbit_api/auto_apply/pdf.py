"""A plain, ATS-safe PDF of a resume: one column of selectable text in Helvetica, the sections in the resume's own
order. It's the file an executor uploads with an application (the web app's designed PDF is drawn in the browser,
so the server writes its own). No dependency: a PDF of text is a few objects and a cross-reference table.
"""

from __future__ import annotations

import re

from orbit_api.resumes.schema import EXTRA_PREFIX, ResumeData

PAGE_W, PAGE_H = 612, 792  # US Letter, in points
MARGIN = 54
_ASCII = {"\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
          "\u00a0": " ", "\u2026": "...", "\u20b9": "Rs ", "\u2192": "->"}
# Helvetica's average advance is about half an em; a little more keeps wrapped lines inside the margin.
_EM = 0.53


def _latin(text: str) -> str:
    out = "".join(_ASCII.get(ch, ch) for ch in text)
    return out.encode("cp1252", "replace").decode("cp1252")


def _escape(text: str) -> str:
    return _latin(text).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(text: str, size: float, width: float) -> list[str]:
    per_line = max(int(width / (size * _EM)), 10)
    words, lines, line = text.split(), [], ""
    for w in words:
        if line and len(line) + 1 + len(w) > per_line:
            lines.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    if line:
        lines.append(line)
    return lines or [""]


class _Pages:
    def __init__(self) -> None:
        self.pages: list[list[str]] = [[]]
        self.y: float = PAGE_H - MARGIN

    def line(self, text: str, size: float = 10, bold: bool = False, indent: float = 0, gap: float = 1.35) -> None:
        if self.y - size * gap < MARGIN:
            self.pages.append([])
            self.y = PAGE_H - MARGIN
        self.y -= size * gap
        font = "F2" if bold else "F1"
        self.pages[-1].append(f"BT /{font} {size} Tf {MARGIN + indent:.1f} {self.y:.1f} Td ({_escape(text)}) Tj ET")

    def para(self, text: str, size: float = 10, bold: bool = False, indent: float = 0, bullet: bool = False) -> None:
        width = PAGE_W - 2 * MARGIN - indent - (10 if bullet else 0)
        for i, part in enumerate(_wrap(text, size, width)):
            if bullet:
                self.line(("• " if i == 0 else "   ") + part, size, bold, indent)
            else:
                self.line(part, size, bold, indent)

    def space(self, points: float) -> None:
        self.y -= points


def _dates(start: str, end: str, current: bool) -> str:
    return " - ".join(x for x in (start, "Present" if current else end) if x)


def resume_pdf(data: ResumeData) -> bytes:
    data = data.visible()
    p = _Pages()
    b = data.basics
    if b.name:
        p.line(b.name, 18, bold=True, gap=1.2)
    if b.headline:
        p.para(b.headline, 11)
    contact = " | ".join(x for x in (b.email, b.phone, b.location, *(link.url for link in b.links)) if x)
    if contact:
        p.para(contact, 9)
    titles = {"summary": "Summary", "experience": "Experience", "skills": "Skills", "projects": "Projects",
              "education": "Education", "certifications": "Certifications", **data.titles}
    extras = {EXTRA_PREFIX + x.id: x for x in data.extras}

    def heading(label: str) -> None:
        p.space(6)
        p.line(label.upper(), 11, bold=True)

    for section in data.section_order:
        if section == "summary" and b.summary.strip():
            heading(titles["summary"])
            p.para(b.summary)
        elif section == "experience" and data.experience:
            heading(titles["experience"])
            for e in data.experience:
                p.para(" - ".join(x for x in (e.title, e.company) if x), 10.5, bold=True)
                meta = " | ".join(x for x in (_dates(e.start, e.end, e.current), e.location) if x)
                if meta:
                    p.para(meta, 9)
                for bullet in e.bullets:
                    if bullet.strip():
                        p.para(bullet, bullet=True, indent=6)
                p.space(3)
        elif section == "skills" and data.skills:
            heading(titles["skills"])
            for g in data.skills:
                items = ", ".join(i for i in g.items if i.strip())
                if items:
                    p.para(f"{g.name}: {items}" if g.name else items)
        elif section == "projects" and data.projects:
            heading(titles["projects"])
            for pr in data.projects:
                p.para(pr.name, 10.5, bold=True)
                if pr.description:
                    p.para(pr.description)
                for bullet in pr.bullets:
                    if bullet.strip():
                        p.para(bullet, bullet=True, indent=6)
        elif section == "education" and data.education:
            heading(titles["education"])
            for ed in data.education:
                p.para(", ".join(x for x in (ed.degree, ed.field) if x) or ed.school, 10.5, bold=True)
                meta = " | ".join(x for x in (ed.school if (ed.degree or ed.field) else "",
                                              _dates(ed.start, ed.end, False), ed.grade) if x)
                if meta:
                    p.para(meta, 9)
        elif section == "certifications" and data.certifications:
            heading(titles["certifications"])
            for c in data.certifications:
                p.para(" - ".join(x for x in (c.name, c.issuer, c.date) if x))
        elif section in extras and extras[section].items:
            x = extras[section]
            heading(x.title or "More")
            if x.style == "inline":
                p.para(" | ".join(x.items))
            else:
                for item in x.items:
                    p.para(item, bullet=True, indent=6)
    return _document(p.pages, b.name or "Resume")


def _document(pages: list[list[str]], title: str) -> bytes:
    objects: list[bytes] = []
    n_pages = len(pages)
    first_page = 5
    kids = " ".join(f"{first_page + 2 * i} 0 R" for i in range(n_pages))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    for i, ops in enumerate(pages):
        content = "\n".join(ops).encode("cp1252", "replace")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << "
                       f"/F1 3 0 R /F2 4 0 R >> >> /Contents {first_page + 2 * i + 1} 0 R >>".encode())
        objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
    info_title = re.sub(r"[()\\]", "", _latin(title))[:100]
    objects.append(f"<< /Title ({info_title}) /Producer (Orbit) >>".encode("cp1252", "replace"))
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info {len(objects)} 0 R >>\nstartxref\n{xref}\n"
            "%%EOF\n").encode()
    return bytes(out)
