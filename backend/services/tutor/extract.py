"""
Deterministic PDF reading for the dynamic study mode (no AI, no cost).

pdfplumber gives us, page by page and in order:
  • the text (with the spaces the PDF actually contains, so indented code
    keeps its indentation);
  • tables, rendered as small Markdown tables;
  • how many images the page has and how much of it they cover.

Pages that carry little or no extractable text but do carry images (scanned
slides, screenshots of code, diagrams) are flagged `needs_vision`. Only
those pages are later cut into a small PDF (sub_pdf) and sent to the vision
model, instead of sending the whole lecture.

Nothing here invents content: a page we could not read is reported as such.
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import asdict, dataclass, field

logger = logging.getLogger(__name__)

MAX_PAGES = 120
MAX_PAGE_CHARS = 5000
MAX_TABLES_PER_PAGE = 3
# Below this many letters a page is treated as "no text layer".
MIN_TEXT_CHARS = 40
# A page whose images cover this share of it and that has little text is
# probably a diagram / screenshot worth a look by the vision model.
IMAGE_AREA_FOR_VISION = 0.35
TEXT_CHARS_WITH_BIG_IMAGE = 400


class ExtractError(Exception):
    """`str(exc)` is a short machine code: broken | too many pages | empty."""


@dataclass
class PageContent:
    n: int  # 1-based page number in the original file
    text: str = ""
    tables: list[str] = field(default_factory=list)
    images: int = 0
    image_area: float = 0.0
    needs_vision: bool = False
    # "text" (pdfplumber) · "vision" (read by the model) · "none" (unread)
    source: str = "text"
    # Model description of diagrams/figures on the page (vision pages only).
    visual: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "PageContent":
        keys = cls.__dataclass_fields__.keys()
        return cls(**{k: v for k, v in (d or {}).items() if k in keys})

    @property
    def readable(self) -> bool:
        return self.source != "none" and bool(self.text.strip() or self.visual.strip() or self.tables)


_LETTERS = re.compile(r"[A-Za-z؀-ۿ0-9]")


def letter_count(text: str) -> int:
    return len(_LETTERS.findall(text or ""))


def _clean_text(raw: str) -> str:
    lines = [ln.rstrip() for ln in (raw or "").replace("\r", "").split("\n")]
    # Collapse runs of blank lines, keep leading spaces (code indentation).
    out: list[str] = []
    for ln in lines:
        if not ln.strip() and out and not out[-1].strip():
            continue
        out.append(ln)
    text = "\n".join(out).strip("\n")
    return text[:MAX_PAGE_CHARS]


def table_to_markdown(rows: list[list]) -> str | None:
    cells = [[re.sub(r"\s+", " ", str(c or "")).strip() for c in row] for row in rows or [] if row]
    cells = [r for r in cells if any(r)]
    if len(cells) < 2:
        return None
    width = max(len(r) for r in cells)
    if width < 2:
        return None
    cells = [r + [""] * (width - len(r)) for r in cells]
    head, *body = cells
    esc = lambda s: s.replace("|", "\\|")  # noqa: E731
    lines = ["| " + " | ".join(esc(c) for c in head) + " |", "|" + " --- |" * width]
    lines += ["| " + " | ".join(esc(c) for c in r) + " |" for r in body]
    return "\n".join(lines)


def _page_content(page, n: int) -> PageContent:
    try:
        raw = page.extract_text(x_tolerance=1.5, y_tolerance=3, keep_blank_chars=True) or ""
    except Exception as exc:  # one bad page must not sink the lecture
        logger.warning("[tutor.extract] page %d text failed: %s", n, exc)
        raw = ""
    text = _clean_text(raw)

    tables: list[str] = []
    try:
        # The default ("lines") table finder builds tables only from ruling lines
        # and rectangle edges — a page with almost none cannot hold a table, so the
        # costly search is skipped there (same result, much less CPU).
        has_rules = len(getattr(page, "lines", []) or []) + len(getattr(page, "rects", []) or []) >= 2
        for t in (page.extract_tables() if has_rules else [])[:MAX_TABLES_PER_PAGE]:
            md = table_to_markdown(t)
            if md:
                tables.append(md[:2000])
    except Exception as exc:
        logger.info("[tutor.extract] page %d tables failed: %s", n, exc)

    images = list(getattr(page, "images", []) or [])
    page_area = float(page.width or 1) * float(page.height or 1)
    covered = 0.0
    for img in images:
        try:
            w = abs(float(img.get("x1", 0)) - float(img.get("x0", 0)))
            h = abs(float(img.get("bottom", 0)) - float(img.get("top", 0)))
            covered += w * h
        except (TypeError, ValueError):
            continue
    area = min(1.0, covered / page_area) if page_area else 0.0

    letters = letter_count(text)
    needs_vision = letters < MIN_TEXT_CHARS and (bool(images) or letters == 0)
    if images and area >= IMAGE_AREA_FOR_VISION and letters < TEXT_CHARS_WITH_BIG_IMAGE:
        needs_vision = True
    return PageContent(
        n=n,
        text=text,
        tables=tables,
        images=len(images),
        image_area=round(area, 3),
        needs_vision=needs_vision,
        source="text" if letters > 0 or tables else "none",
    )


def extract_pages(pdf: bytes) -> list[PageContent]:
    """Read every page in order. Raises ExtractError for broken/oversized files."""
    import pdfplumber

    try:
        doc = pdfplumber.open(io.BytesIO(pdf))
    except Exception as exc:
        logger.info("[tutor.extract] cannot open pdf: %s", exc)
        raise ExtractError("broken") from exc
    try:
        try:
            pages = doc.pages
            count = len(pages)
        except Exception as exc:  # encrypted or damaged xref
            raise ExtractError("broken") from exc
        if count == 0:
            raise ExtractError("empty")
        if count > MAX_PAGES:
            raise ExtractError("too many pages")
        out = []
        for i, page in enumerate(pages, start=1):
            out.append(_page_content(page, i))
            try:
                page.close()  # frees cached objects on long files
            except Exception:
                pass
        return out
    finally:
        doc.close()


def sub_pdf(pdf: bytes, page_numbers: list[int]) -> bytes:
    """A new PDF holding only `page_numbers` (1-based, in that order)."""
    import pypdfium2 as pdfium

    src = pdfium.PdfDocument(pdf)
    try:
        dst = pdfium.PdfDocument.new()
        dst.import_pages(src, [n - 1 for n in page_numbers])
        buf = io.BytesIO()
        dst.save(buf)
        dst.close()
        return buf.getvalue()
    finally:
        src.close()


def page_block(p: PageContent, max_chars: int | None = None) -> str:
    """The page as the model sees it: a header with its number, then content."""
    parts = []
    if p.text.strip():
        parts.append(p.text)
    for t in p.tables:
        parts.append("[جدول]\n" + t)
    if p.visual.strip():
        parts.append("[وصف الرسم/الصورة في الشريحة]\n" + p.visual)
    body = "\n\n".join(parts) if parts else "[تعذّرت قراءة هذه الصفحة]"
    if max_chars is not None and len(body) > max_chars:
        body = body[:max_chars] + " …"
    return f"=== صفحة {p.n} ===\n{body}"
