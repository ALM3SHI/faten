"""
================================================================
UQU Academic Assistant — Regulations knowledge base (RAG retrieval)
================================================================
Answers questions like "كم أغيب قبل الحرمان؟" from the official
university regulations, with the exact article to cite.

  knowledge/regulations/*.pdf        ← official PDFs (source of truth)
  knowledge/build_regulations.py     ← PDF → article chunks
  knowledge/regulations_index.json   ← generated index (loaded here)

Retrieval is lexical BM25 over Arabic-normalized, lightly stemmed
tokens with a small synonym map for student phrasing. It needs no
embeddings API, runs in-process, and costs nothing — the corpus is
only a few hundred articles, where BM25 performs very well.
================================================================
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

INDEX_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "regulations_index.json"

# ── Arabic normalization ──────────────────────────────────────────
_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
_TRANSLATE = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ى": "ي", "ئ": "ي", "ؤ": "و", "ة": "ه",
    "ـ": None,
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
})
_TOKEN = re.compile(r"[ء-يa-z0-9%]+")

_STOPWORDS = {
    "من", "في", "علي", "الي", "عن", "هل", "كم", "ما", "ماذا", "متي", "اذا",
    "او", "و", "ان", "التي", "الذي", "الذين", "هذا", "هذه", "ذلك", "تلك",
    "كيف", "لو", "مع", "لا", "لم", "لن", "قد", "كان", "يكون", "تكون", "اي",
    "به", "بها", "له", "لها", "ثم", "حتي", "بعد", "قبل", "عند", "كل", "غير",
    "ابي", "ابغي", "ابغا", "ودي", "يعني", "طيب", "انا", "احنا", "لي", "عندي",
    "وش", "ايش", "شنو", "كذا", "الحين", "يمديني", "اقدر", "ممكن",
}

_PREFIXES = ("وبال", "وال", "بال", "كال", "فال", "لل", "ال", "و", "ب", "ل", "ف")
_SUFFIXES = ("تها", "تهم", "يات", "ات", "ون", "ين", "تي", "ته", "تك", "ها", "هم", "كم", "ني", "يه", "ه", "ي")


def normalize(text: str) -> str:
    text = _DIACRITICS.sub("", text or "")
    return text.translate(_TRANSLATE).lower()


def _stem(tok: str) -> str:
    for p in _PREFIXES:
        if tok.startswith(p) and len(tok) - len(p) >= 3:
            tok = tok[len(p):]
            break
    for s in _SUFFIXES:
        if tok.endswith(s) and len(tok) - len(s) >= 3:
            tok = tok[: -len(s)]
            break
    return tok


def tokenize(text: str) -> list[str]:
    return [
        _stem(t) for t in _TOKEN.findall(normalize(text))
        if t not in _STOPWORDS and len(t) > 1
    ]


# Student phrasing → regulation vocabulary (applied on stems).
_SYNONYMS_RAW = {
    "غياب": ["حرمان", "حضور"],
    "اغيب": ["غياب", "حرمان", "حضور"],
    "حرمان": ["غياب"],
    "محروم": ["حرمان", "غياب"],
    "انسحب": ["انسحاب"],
    "انسحاب": ["اعتذار", "حذف"],
    "اعتذر": ["اعتذار"],
    "اعتذار": ["انسحاب", "تاجيل"],
    "اجل": ["تاجيل"],
    "تاجيل": ["اعتذار"],
    "انذار": ["فصل", "معدل"],
    "انذارات": ["انذار", "فصل", "معدل"],
    "فصلوني": ["فصل", "انذار"],
    "طي": ["قيد", "انقطاع"],
    "انقطع": ["انقطاع", "طي", "قيد"],
    "تظلم": ["اعتراض", "مراجعه"],
    "اعتراض": ["تظلم"],
    "اعترض": ["تظلم", "اعتراض"],
    "شرف": ["مرتبه"],
    "تحويل": ["معادله"],
    "احول": ["تحويل"],
    "انقل": ["تحويل", "نقل"],
    "نقل": ["تحويل"],
    "بديل": ["عذر"],
    "تخرج": ["متطلب"],
    "اتخرج": ["تخرج", "متطلب"],
    "ساعات": ["وحد", "عبء"],
    "عبء": ["وحد", "تسجيل"],
    "رسب": ["رسوب", "اعاده"],
    "ارسب": ["رسوب", "اعاده"],
    "اعيد": ["اعاده"],
    "فاينل": ["نهايي", "اختبار"],
    "غش": ["مخالف", "عقوب", "اختبار"],
    "ماده": ["مقرر"],
    "مواد": ["مقرر", "مقررات"],
    "انسحب": ["انسحاب"],
    "اسحب": ["انسحاب"],
    "استيجار": ["انتفاع", "املاك"],
    "استاجر": ["انتفاع", "املاك"],
    "احجز": ["انتفاع", "حجز"],
    "ماجستير": ["عليا", "دراسات"],
    "دكتوراه": ["عليا", "دراسات"],
    "معيد": ["ابتعاث", "معيدين"],
    "عقوبه": ["عقوب", "مخالف", "جزاء"],
    "نادي": ["اندي", "نشاط"],
    "قرض": ["صندوق", "اعانه"],
    "اعانه": ["صندوق", "قرض"],
    "مكافاه": ["صندوق", "اعانه"],
    "حقوق": ["حق"],
    "حقي": ["حق", "حقوق"],
    "يفصلوني": ["انذار", "طي", "قيد"],
    "يفصل": ["انذار", "طي"],
    "طرد": ["انذار", "فصل"],
    "ينطرد": ["انذار", "فصل"],
    "اقل": ["ادني", "يقل"],
    "اكثر": ["اعلي", "يزيد"],
    "ترم": ["فصل", "دراسي"],
    "سمستر": ["فصل", "دراسي"],
    "اسجل": ["تسجيل", "عبء"],
    "ااجل": ["تاجيل"],
    "اوجل": ["تاجيل"],
    "ارجع": ["اعاده", "قيد"],
    "رجوع": ["اعاده", "قيد"],
    "ميد": ["فصلي", "اختبار"],
}
_SYNONYMS: dict[str, list[str]] = {}
for _k, _vals in _SYNONYMS_RAW.items():
    _SYNONYMS[_stem(normalize(_k))] = [_stem(normalize(v)) for v in _vals]


def _expand(tokens: list[str]) -> Counter:
    weights: Counter = Counter()
    for t in tokens:
        weights[t] += 1.0
        for s in _SYNONYMS.get(t, []):
            weights[s] += 0.8
    return weights


# ── Index ─────────────────────────────────────────────────────────
class _Index:
    def __init__(self, data: dict[str, Any]) -> None:
        self.documents = {d["id"]: d for d in data.get("documents", [])}
        self.chunks: list[dict[str, Any]] = data.get("chunks", [])
        self.tfs: list[Counter] = []
        self.lengths: list[int] = []
        df: Counter = Counter()
        for c in self.chunks:
            # Heading counted twice: it names the topic of the article.
            toks = tokenize(c.get("heading", "")) * 2 + tokenize(c.get("text", ""))
            tf = Counter(toks)
            self.tfs.append(tf)
            self.lengths.append(len(toks))
            df.update(tf.keys())
        # Student-facing documents first: this is a student assistant, and many
        # staff regulations share vocabulary (leave, absence, discipline…).
        prior = {"students": 1.25, "general": 1.0, "staff": 0.8}
        self.doc_prior = {i: d.get("priority") or prior.get(d.get("audience", "general"), 1.0)
                          for i, d in self.documents.items()}
        self.doc_title_tokens = {i: set(tokenize(d.get("title", ""))) for i, d in self.documents.items()}
        n = max(len(self.chunks), 1)
        self.avg_len = (sum(self.lengths) / n) if self.lengths else 1.0
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def search(self, query: str, k: int = 4) -> list[tuple[float, dict[str, Any]]]:
        q = _expand(tokenize(query))
        if not q or not self.chunks:
            return []
        k1, b = 1.5, 0.75
        scored = []
        for i, tf in enumerate(self.tfs):
            score = 0.0
            norm = k1 * (1 - b + b * self.lengths[i] / self.avg_len)
            for term, qw in q.items():
                f = tf.get(term)
                if f:
                    score += qw * self.idf.get(term, 0.0) * (f * (k1 + 1)) / (f + norm)
            if score > 0:
                doc_id = self.chunks[i].get("doc_id")
                score *= self.doc_prior.get(doc_id, 1.0)
                # Query names the document ("نظام الجامعات", "لائحة الإسكان") → boost it.
                if len(self.doc_title_tokens.get(doc_id, set()) & set(q)) >= 2:
                    score *= 2.0
                scored.append((score, self.chunks[i]))
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[:k]


@lru_cache(maxsize=1)
def _load_index() -> _Index:
    if not INDEX_PATH.exists():
        logger.warning("[regulations] index not built yet: %s", INDEX_PATH)
        return _Index({})
    data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    idx = _Index(data)
    logger.info("[regulations] loaded %d chunks from %d documents", len(idx.chunks), len(idx.documents))
    return idx


def search_regulations(query: str, k: int = 5, max_chars: int = 1500) -> dict[str, Any]:
    """Tool entry point — returns the best-matching articles with citations."""
    idx = _load_index()
    if not idx.chunks:
        return {
            "success": True,
            "found": False,
            "message": "قاعدة اللوائح غير مُحمّلة بعد على الخادم. اعتذر للطالب ووجّهه لعمادة القبول والتسجيل.",
        }
    hits = idx.search(query, k=k)
    if not hits:
        return {
            "success": True,
            "found": False,
            "message": "لم أجد مادة مطابقة في اللوائح. لا تخترع حكمًا؛ وجّه الطالب لعمادة القبول والتسجيل.",
        }
    results = []
    for score, c in hits:
        doc = idx.documents.get(c.get("doc_id"), {})
        text = c.get("text", "")
        results.append({
            "document": doc.get("title", ""),
            "audience": {"students": "الطلاب", "staff": "منسوبو الجامعة", "general": "عام"}.get(doc.get("audience", ""), ""),
            "issued": doc.get("issued", ""),
            "article": c.get("article", ""),
            "heading": c.get("heading", ""),
            "text": text if len(text) <= max_chars else text[:max_chars] + "…",
            "source_url": doc.get("source_url", ""),
            "score": round(score, 2),
            **({"note": "نص مستخرج آليًا من صورة ممسوحة وقد يحتوي أخطاء في الأرقام — نبّه الطالب للتحقق من الأصل."}
               if c.get("ocr") else {}),
        })
    return {"success": True, "found": True, "results": results}
