"""
================================================================
Build the regulations index used by services/regulations.py
================================================================
Usage (from backend/):
    python knowledge/build_regulations.py

Reads every PDF listed in knowledge/regulations/sources.json, rebuilds
the Arabic text from the PDF glyphs (fixing the lam-alef ligature and
digit order that normal extractors break), splits it into articles
("المادة ...") and writes knowledge/regulations_index.json.

Re-run it whenever a PDF is added or replaced, and commit the JSON.
================================================================
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
SRC_DIR = HERE / "regulations"
MANIFEST = SRC_DIR / "sources.json"
OUT = HERE / "regulations_index.json"

_LTR_RUN = re.compile(r"[0-9A-Za-z][0-9A-Za-z\.\-/:%,]*[0-9A-Za-z%]|[0-9A-Za-z]")
_HARAKAT = re.compile(r"[ً-ْٰ]")
_ONLY_MARKS = re.compile(r"^[\sً-ْٰـ]*$")


# ── PDF → logical-order lines ─────────────────────────────────────
def _page_lines(page, y_tol: float = 3.0) -> list[str]:
    chars = [c for c in page.chars if c["text"].strip() or c["text"] == " "]
    rows: list[dict] = []
    for c in sorted(chars, key=lambda c: (round(c["top"]), c["x0"])):
        for r in rows:
            if abs(r["top"] - c["top"]) <= y_tol:
                r["chars"].append(c)
                break
        else:
            rows.append({"top": c["top"], "chars": [c]})

    lines = []
    for r in sorted(rows, key=lambda r: r["top"]):
        cs = sorted(r["chars"], key=lambda c: c["x0"])
        toks, prev = [], None
        for c in cs:
            if prev is not None and c["x0"] - prev["x1"] > 1.5 and " " not in (c["text"], prev["text"]):
                toks.append(" ")
            toks.append(c["text"])
            prev = c
        # Glyphs are in visual (left→right) order; reverse to logical RTL.
        # Multi-char glyphs such as the "لا" ligature stay intact.
        line = unicodedata.normalize("NFKC", "".join(reversed(toks)))
        line = _LTR_RUN.sub(lambda m: m.group(0)[::-1], line)  # digits/Latin back to LTR
        line = re.sub(r" [ً-ْ](?=\S)", "", line)      # "كا ٍف" → "كاف"
        line = _HARAKAT.sub("", line)
        line = re.sub(r"%(\d+)", r"\1%", line)                    # "(%25)" → "(25%)"
        line = re.sub(r"ـ{2,}", "", line)
        line = re.sub(r"\s+", " ", line).strip()
        if line and not _ONLY_MARKS.match(line):
            lines.append(line)
    return lines


# ── Arabic ordinal → number ("الثالثة عشرة" → 13) ─────────────────
_UNITS = {
    "الأولى": 1, "الاولى": 1, "الحادية": 1, "الثانية": 2, "الثالثة": 3, "الرابعة": 4,
    "الخامسة": 5, "السادسة": 6, "السابعة": 7, "الثامنة": 8, "التاسعة": 9, "العاشرة": 10,
}
_TENS = {"العشرون": 20, "الثلاثون": 30, "الأربعون": 40, "الاربعون": 40,
         "الخمسون": 50, "الستون": 60, "السبعون": 70, "الثمانون": 80, "التسعون": 90,
         "المائة": 100, "المئة": 100}
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def ordinal_to_int(words: str) -> int | None:
    import difflib
    digits = re.sub(r"\D", "", words.translate(_DIGITS))
    if digits:
        return int(digits)
    w = [t for t in _HARAKAT.sub("", words).replace("(", " ").replace(")", " ").split() if t != "بعد"]
    total = 0
    vocab = list(_UNITS) + list(_TENS)
    for token in w:
        token = token.lstrip("و") if token.startswith("وال") else token
        if token not in _UNITS and token not in _TENS and token not in ("عشرة", "عشر"):
            close = difflib.get_close_matches(token, vocab, n=1, cutoff=0.75)  # OCR typos
            token = close[0] if close else token
        if token in _TENS:
            total += _TENS[token]
        elif token in _UNITS:
            total += _UNITS[token]
        elif token in ("عشرة", "عشر"):
            total += 10
    return total or None


_ORD = r"(?:و?ال[^\s:()]+)(?:\s+(?:و?ال[^\s:()]+|عشرة|عشر|بعد))*|[0-9٠-٩]+"
_ARTICLE = re.compile(rf"^(?:المادة|مادة)\s*\(?\s*({_ORD})\s*\)?\s*(?:[:\-–]\s*(.*))?$")
_ANNEX = re.compile(r"^(الملاحق|الملحق)\b.*$")
_CHAPTER = re.compile(r"^((?:الفصل|الباب)\s+\S+.*?:.*)$")
_SECTION = re.compile(r"^\(\d+-\d+\)\s*\S.*$")
_TOC = re.compile(r"\.{5,}")


def _is_heading(ln: str) -> bool:
    return (len(ln) <= 70 and not ln.endswith((".", "،", "؛", ",")) and len(ln.split()) <= 10
            and not re.match(r"^[\-•\d٠-٩(]", ln))


def split_blocks(lines: list[str], doc_id: str, target: int = 1200) -> list[dict]:
    """Heading-aware windows for policies/guides that have no articles."""
    chunks, buf, label, n = [], [], "", 0

    def flush():
        nonlocal buf, n
        text = "\n".join(buf).strip()
        if len(text) >= 25:
            n += 1
            chunks.append({"id": f"{doc_id}:b{n}", "doc_id": doc_id,
                           "article": label or f"جزء {n}", "heading": label, "text": text})
        buf = []

    for ln in lines:
        if ln.startswith("<<<PAGE"):
            continue
        if _is_heading(ln) and sum(len(x) for x in buf) > 300:
            flush()
            label = ln
        elif _is_heading(ln) and not buf:
            label = ln
        buf.append(ln)
        if sum(len(x) for x in buf) > target:
            flush()
    flush()
    return chunks


def split_articles(lines: list[str], doc_id: str, mode: str = "article") -> list[dict]:
    chunks: list[dict] = []
    chapter, current = "", None

    def flush():
        if current and current["lines"]:
            text = "\n".join(current["lines"]).strip()
            # Long articles → ~1500-char parts on line boundaries.
            parts, buf = [], ""
            for ln in text.split("\n"):
                if len(buf) + len(ln) > 1500 and buf:
                    parts.append(buf.strip()); buf = ""
                buf += ln + "\n"
            if buf.strip():
                parts.append(buf.strip())
            for i, part in enumerate(parts):
                if len(part) < 25:
                    continue  # table-of-contents remnants
                chunks.append({
                    "id": f"{doc_id}:{current['key']}" + (f":{i+1}" if len(parts) > 1 else ""),
                    "doc_id": doc_id,
                    "article": current["label"],
                    "heading": " — ".join(x for x in (current["chapter"], current["label"]) if x),
                    "text": part,
                })

    for ln in lines:
        if mode == "pages" and ln.startswith("<<<PAGE"):
            flush()
            num = re.sub(r"\D", "", ln)
            current = {"label": f"صفحة {num}", "key": f"p{num}", "chapter": "", "lines": []}
            continue
        if _TOC.search(ln):
            continue
        m_ch = _CHAPTER.match(ln)
        if m_ch and mode != "chapter":
            chapter = m_ch.group(1)
            continue
        if mode == "chapter" and m_ch:
            flush()
            current = {"label": m_ch.group(1), "key": f"ch{len(chunks)}", "chapter": "", "lines": []}
            continue
        if mode == "section" and _SECTION.match(ln):
            flush()
            current = {"label": ln, "key": f"sec{len(chunks)}", "chapter": chapter, "lines": []}
            continue
        m_art = _ARTICLE.match(ln) if mode == "article" else None
        m_anx = _ANNEX.match(ln) if mode == "article" else None
        if m_art or m_anx:
            flush()
            if m_art:
                num = ordinal_to_int(m_art.group(1))
                label = f"المادة {num}" if num else ln
                key = f"art{num}" if num else f"art_{len(chunks)}"
                if m_art.group(2) and re.search(r"[\u0621-\u064A]{3}", m_art.group(2)):
                    label += f": {m_art.group(2)}"
            else:
                label, key = "الملحق (1) — جدول التقديرات وأوزانها", f"annex{len(chunks)}"
            current = {"label": label, "key": key, "chapter": chapter, "lines": []}
            continue
        if current is not None:
            current["lines"].append(ln)
    flush()
    return chunks


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    documents, chunks = [], []
    for doc in manifest["documents"]:
        pdf_path = SRC_DIR / doc["file"]
        if not pdf_path.exists():
            print(f"!! missing {pdf_path.name} — skipped")
            continue
        repeated = set(doc.get("strip_lines", []))
        if pdf_path.suffix == ".txt":  # copied web text, or pre-OCR'd scan ("ocr" flag)
            raw_lines = [re.sub(r"\s+", " ", l).strip() for l in pdf_path.read_text(encoding="utf-8").splitlines()]
        else:
            with pdfplumber.open(pdf_path) as pdf:
                raw_lines = [ln for page in pdf.pages for ln in _page_lines(page)]
        lines = [
            ln for ln in raw_lines
            if ln and ln not in repeated
            and not re.fullmatch(r"\d{1,3}", ln)            # page numbers
            and "uqu.edu.sa/studaff" not in ln               # running footer
        ]
        mode = doc.get("split", "auto")
        if mode == "auto":
            n_art = sum(1 for ln in lines if _ARTICLE.match(ln))
            mode = "article" if n_art >= 3 else "blocks"
        doc_chunks = (split_blocks(lines, doc["id"]) if mode == "blocks"
                      else split_articles(lines, doc["id"], mode))
        for c in doc_chunks:
            if doc.get("ocr"):
                c["ocr"] = True
        print(f"{doc['id']}: {len(lines)} lines → {len(doc_chunks)} chunks")
        print(f"   mode={mode}")
        documents.append({k: doc[k] for k in ("id", "title", "issued", "source_url", "ocr", "audience", "priority") if k in doc})
        chunks.extend(doc_chunks)

    OUT.write_text(json.dumps({"documents": documents, "chunks": chunks}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT.name}: {len(chunks)} chunks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
