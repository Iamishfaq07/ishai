"""The resume as a Word file: one plain column in reading order, built from real Word styles (headings, bullet
lists, a right tab stop for dates), so ATS software and recruiters who ask for .docx read it cleanly.

Only the design choices that survive in Word carry over: font, size, accent colour, spacing and page size. The
layout is always single-column and has no photo, since that's what ATS parsers read most reliably.
"""

import io
from datetime import UTC, datetime

from docx import Document
from docx.document import Document as DocxDocument
from docx.enum.text import WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor
from docx.text.paragraph import Paragraph

from orbit_api.resumes.schema import EXTRA_PREFIX, ExtraSection, ResumeData, ResumeDesign

SECTION_LABEL: dict[str, str] = {
    "summary": "Summary",
    "experience": "Experience",
    "education": "Education",
    "skills": "Skills",
    "projects": "Projects",
    "certifications": "Certifications",
}
# Fonts every copy of Word has; the web-only ones fall back to the closest match.
WORD_FONT = {"inter": "Calibri", "arial": "Arial", "georgia": "Georgia", "garamond": "Garamond",
             "grotesk": "Calibri", "calibri": "Calibri", "cambria": "Cambria", "helvetica": "Arial",
             "times": "Times New Roman", "trebuchet": "Trebuchet MS"}
LINE_SPACING = {"tight": 1.05, "normal": 1.15, "airy": 1.3}
PAGE_MM = {"a4": (210, 297), "letter": (215.9, 279.4)}
# Page margin, gap before a section heading, gap after an entry: the same steps as the preview.
SPACING = {"compact": (12, 9, 5), "normal": (16, 13, 7), "relaxed": (20, 17, 10)}


def _date_range(start: str, end: str, current: bool = False) -> str:
    to = "Present" if current else end.strip()
    return " – ".join(p for p in (start.strip(), to) if p)


def extra_section(data: ResumeData, key: str) -> ExtraSection | None:
    """The extra section a section_order entry ("extra:<id>") names, if it exists."""
    if not key.startswith(EXTRA_PREFIX):
        return None
    return next((x for x in data.extras if x.id == key[len(EXTRA_PREFIX):]), None)


def _has_content(data: ResumeData, section: str) -> bool:
    if section == "summary":
        return bool(data.basics.summary.strip())
    if section == "skills":
        return any(i.strip() for s in data.skills for i in s.items)
    if section.startswith(EXTRA_PREFIX):
        extra = extra_section(data, section)
        return extra is not None and bool(extra.title.strip()) and any(i.strip() for i in extra.items)
    return bool(getattr(data, section, None))


_PBDR_SUCCESSORS = ("w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap", "w:overflowPunct",
                    "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:bidi", "w:adjustRightInd",
                    "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents",
                    "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment", "w:textboxTightWrap",
                    "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange")


def _bottom_border(par: Paragraph, color: str) -> None:
    ppr = par._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    for key, value in (("w:val", "single"), ("w:sz", "6"), ("w:space", "1"), ("w:color", color.lstrip("#"))):
        bottom.set(qn(key), value)
    bdr.append(bottom)
    # Word rejects paragraph properties out of schema order ("unreadable content"), so place it before its successors.
    ppr.insert_element_before(bdr, *_PBDR_SUCCESSORS)


class _Writer:
    def __init__(self, design: ResumeDesign) -> None:
        self.doc: DocxDocument = Document()
        self.accent = RGBColor.from_string(design.accent.lstrip("#").upper())
        self.accent_hex = design.accent
        margin, self.section_gap, self.item_gap = SPACING[design.spacing]
        section = self.doc.sections[0]
        width, height = PAGE_MM[design.page]
        section.page_width, section.page_height = Mm(width), Mm(height)
        for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
            setattr(section, side, Mm(margin))
        self.text_width = Mm(width - 2 * margin)
        normal = self.doc.styles["Normal"]
        normal.font.name = WORD_FONT[design.font]
        normal.font.size = Pt(design.font_size)
        # East-Asian and complex-script text would otherwise keep the theme font.
        rfonts = normal.element.get_or_add_rPr().get_or_add_rFonts()
        for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            rfonts.set(qn(attr), WORD_FONT[design.font])
        normal.paragraph_format.space_after = Pt(0)
        normal.paragraph_format.line_spacing = LINE_SPACING[design.line_height]

    def properties(self, kind: str, name: str) -> None:
        """What Word's File > Info shows, and what some job portals read: the candidate, not "python-docx"."""
        props = self.doc.core_properties
        name = name.strip()
        props.title = f"{name} - {kind}" if name else kind
        props.author = props.last_modified_by = name
        props.comments = props.subject = props.keywords = props.category = ""

    def par(self, text: str = "", *, bold: bool = False, size: float | None = None, color: RGBColor | None = None,
            style: str | None = None, after: float = 0) -> Paragraph:
        p = self.doc.add_paragraph(style=style)
        if text:
            run = p.add_run(text)
            run.bold = bold
            if size:
                run.font.size = Pt(size)
            if color is not None:
                run.font.color.rgb = color
        p.paragraph_format.space_after = Pt(after)
        return p

    def heading(self, label: str) -> None:
        # A real Heading 1 so parsers and screen readers see the section structure, styled to match the resume.
        p = self.doc.add_paragraph(style="Heading 1")
        run = p.add_run(label.upper())
        run.font.size = Pt(11)
        run.font.color.rgb = self.accent
        run.font.name = self.doc.styles["Normal"].font.name
        run.bold = True
        fmt = p.paragraph_format
        fmt.space_before, fmt.space_after, fmt.keep_with_next = Pt(self.section_gap), Pt(3), True
        _bottom_border(p, self.accent_hex)

    def entry_line(self, left: list[tuple[str, bool]], right: str) -> None:
        """"Title, Company · Location" on the left and the dates flush right, on one line."""
        p = self.doc.add_paragraph()
        p.paragraph_format.tab_stops.add_tab_stop(self.text_width, WD_TAB_ALIGNMENT.RIGHT)
        p.paragraph_format.keep_with_next = True
        for text, bold in left:
            p.add_run(text).bold = bold
        if right:
            p.add_run("\t" + right)

    def bullets(self, items: list[str]) -> None:
        for item in items:
            if item.strip():
                self.par(item.strip(), style="List Bullet")

    def gap(self) -> None:
        paragraphs = self.doc.paragraphs
        if paragraphs:
            paragraphs[-1].paragraph_format.space_after = Pt(self.item_gap)


def resume_docx(data: ResumeData, design: ResumeDesign) -> bytes:
    w = _Writer(design)
    data = data.visible()
    b = data.basics
    w.par(b.name.strip() or "Your name", bold=True, size=design.font_size * 2)
    if b.headline.strip():
        w.par(b.headline.strip(), color=w.accent, size=design.font_size * 1.1)
    contacts = [s.strip() for s in (b.email, b.phone, b.location, *(link.url for link in b.links)) if s.strip()]
    if contacts:
        w.par("  ·  ".join(contacts))

    for section in data.section_order:
        if not _has_content(data, section):
            continue
        extra = extra_section(data, section)
        w.heading(extra.title.strip() if extra else data.titles.get(section) or SECTION_LABEL[section])
        if extra:
            items = [i.strip() for i in extra.items if i.strip()]
            if extra.style == "inline":
                w.par("  ·  ".join(items))
            else:
                w.bullets(items)
        elif section == "summary":
            w.par(b.summary.strip())
        elif section == "experience":
            for e in data.experience:
                left = [(e.title, True)] if e.title else []
                if e.company:
                    left.append(((", " if e.title else "") + e.company, False))
                if e.location:
                    left.append((" · " + e.location, False))
                w.entry_line(left, _date_range(e.start, e.end, e.current))
                w.bullets(e.bullets)
                w.gap()
        elif section == "education":
            for ed in data.education:
                degree = ", ".join(p for p in (ed.degree, ed.field) if p)
                left = [(degree or ed.school, True)]
                if degree and ed.school:
                    left.append((", " + ed.school, False))
                w.entry_line(left, _date_range(ed.start, ed.end))
                if ed.details.strip():
                    w.par(ed.details.strip())
                w.gap()
        elif section == "skills":
            for group in data.skills:
                items = [i.strip() for i in group.items if i.strip()]
                if items:
                    p = w.par()
                    if group.name.strip():
                        p.add_run(group.name.strip() + ": ").bold = True
                    p.add_run(", ".join(items))
        elif section == "projects":
            for pr in data.projects:
                p = w.par(pr.name, bold=True)
                p.paragraph_format.keep_with_next = True
                if pr.link.strip():
                    p.add_run(" · " + pr.link.strip())
                if pr.description.strip():
                    w.par(pr.description.strip())
                w.bullets(pr.bullets)
                w.gap()
        elif section == "certifications":
            for c in data.certifications:
                p = w.par(c.name, bold=True)
                issued = ", ".join(x for x in (c.issuer, c.date) if x.strip())
                if issued:
                    p.add_run(" · " + issued)

    w.properties("Resume", b.name)
    buf = io.BytesIO()
    w.doc.save(buf)
    return buf.getvalue()


def letter_docx(text: str, data: ResumeData, design: ResumeDesign) -> bytes:
    """The cover letter on a page that matches the resume: the same name and contact line, then today's date and the
    letter's paragraphs (a single line break inside one, e.g. "Sincerely," / the name, stays a line break)."""
    w = _Writer(design)
    b = data.basics
    if b.name.strip():
        w.par(b.name.strip(), bold=True, size=design.font_size * 1.6)
    contacts = [s.strip() for s in (b.email, b.phone, b.location, *(link.url for link in b.links)) if s.strip()]
    if contacts:
        w.par("  ·  ".join(contacts), after=w.section_gap)
    today = datetime.now(UTC)
    w.par(f"{today.day} {today:%B %Y}", after=w.section_gap)
    for block in (p.strip() for p in text.replace("\r\n", "\n").split("\n\n")):
        if not block:
            continue
        p = w.par(after=w.item_gap + 3)
        for i, line in enumerate(block.split("\n")):
            if i:
                p.add_run().add_break()
            p.add_run(line.strip())
    w.properties("Cover letter", b.name)
    buf = io.BytesIO()
    w.doc.save(buf)
    return buf.getvalue()
