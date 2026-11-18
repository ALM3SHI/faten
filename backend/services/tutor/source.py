"""
One way in for every kind of lecture file.

Each file type has an extractor that turns the file into the same thing: a
list of pages (PageContent — text, tables, image coverage, whether the page
needs the vision model). Everything after this layer (vision, structure,
lessons, questions) works on pages and never asks what the file was.

Only PDF is accepted today. A new type (PPTX, Word, notebooks) is one more
Extractor here: how to recognise it, how to read its pages, and how to cut
out a few pages for the vision model.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from services.tutor.extract import PageContent, extract_pages, sub_pdf


@dataclass(frozen=True)
class Extractor:
    kind: str
    # Does this file belong to this extractor? (by its bytes, not its name)
    detect: Callable[[bytes, str], bool]
    # File → pages, in order. Raises extract.ExtractError (broken | too many pages | empty).
    extract: Callable[[bytes], list[PageContent]]
    # A smaller file holding only these pages (1-based), for the vision model.
    subset: Callable[[bytes, list[int]], bytes]


PDF = Extractor(
    kind="pdf",
    detect=lambda data, _name: data[:1024].lstrip().startswith(b"%PDF"),
    extract=extract_pages,
    subset=sub_pdf,
)

EXTRACTORS: tuple[Extractor, ...] = (PDF,)


def detect(data: bytes, file_name: str = "") -> Extractor | None:
    """The extractor for this file, or None when the type is not supported."""
    return next((e for e in EXTRACTORS if e.detect(data, file_name)), None)
