"""A scripted stand-in for the model, shaped like the real prompts' JSON."""

from __future__ import annotations

import re
from collections import Counter


class FakeTutorAI:
    def __init__(self, vision_readable: bool = True, structure_topics: list | None = None):
        self.calls: Counter = Counter()
        self.vision_readable = vision_readable
        self.structure_topics = structure_topics
        self.n = 0
        self.vision_pdf_sizes: list[int] = []
        self.structure_inputs: list[str] = []

    def _q(self, pool, concept, bloom="apply", diff=2, fmt="choice", seg=None, skill="apply"):
        self.n += 1
        q = {
            "pool": pool,
            "format": fmt,
            "skill": skill,
            "bloom": bloom,
            "difficulty": diff,
            "concept_ids": [concept],
            "prompt": f"سؤال رقم {self.n} عن {concept} ({pool})",
            "hints": ["فكّر في التعريف", "راجع المثال في الصفحة"],
            "explanation": "لأن هذا ما تقوله الشريحة [ص 1]",
            "pages": [1],
        }
        if seg is not None:
            q["segment"] = seg
        if fmt == "choice":
            q.update({
                "options": ["خيار أ", "خيار صحيح", "خيار ج", "خيار د"],
                "answer_index": 1,
                "option_feedback": ["تخلط بين المكدس والطابور", "", "نسيت الشرط", "قرأت السؤال بسرعة"],
                "misconceptions": ["خلط المكدس بالطابور", "", "إغفال الشرط", "قراءة متسرعة"],
            })
        else:
            q.update({"model_answer": "الإجابة الصحيحة", "rubric": "يذكر الفكرة"})
        return q

    async def __call__(self, prompt: str, user: str, **kw):
        if "little or no text layer" in prompt:
            self.calls["vision"] += 1
            self.vision_pdf_sizes.append(len(kw.get("pdf") or b""))
            n = len(re.findall(r"صفحة \d+", prompt))
            return {"pages": [
                {"index": i + 1, "text": "Diagram: the stack grows upward" if self.vision_readable else "", "visual": "رسم يوضح المكدس" if self.vision_readable else "", "readable": self.vision_readable}
                for i in range(n)
            ]}
        if "planning how to TEACH" in prompt:
            self.calls["structure"] += 1
            self.structure_inputs.append(user)
            pages = [int(x) for x in re.findall(r"=== صفحة (\d+) ===", user)]
            if self.structure_topics is not None:
                return {"title": "هياكل البيانات", "overview": "نظرة", "topics": self.structure_topics}
            topics = []
            for i in range(0, len(pages), 2):
                chunk = pages[i : i + 2]
                topics.append({
                    "title": f"موضوع يبدأ من {chunk[0]}",
                    "pages": [chunk[0], chunk[-1]],
                    "summary": "ملخص",
                    "objectives": ["يطبّق الفكرة"],
                    "concepts": [{"name": f"مفهوم {chunk[0]}أ", "definition": "تعريف"}, {"name": f"مفهوم {chunk[0]}ب", "definition": "تعريف"}],
                    "prerequisites": [len(topics) - 1] if topics else [],
                    "importance": 3 if not topics else 2,
                    "est_minutes": 10,
                    "key_terms": [{"term": f"Term{chunk[0]}", "definition": "معنى"}],
                })
            return {"title": "هياكل البيانات", "overview": "محاضرة عن المكدس", "topics": topics, "unclear_pages": []}
        if "Teach ONE topic" in prompt:
            self.calls["lesson"] += 1
            cids = re.findall(r"- (t\d+c\d+):", prompt)
            c1, c2 = cids[0], cids[-1]
            qs = [self._q("check", c1, "understand", 1, seg=0, skill="explain"), self._q("check", c2, "understand", 1, seg=1, skill="explain")]
            qs += [
                self._q("quiz", c1, "understand", 1, skill="explain"),
                self._q("quiz", c2, "apply", 2),
                self._q("quiz", c1, "apply", 3, skill="predict"),
                self._q("quiz", c2, "analyze", 2, skill="debug"),
                self._q("quiz", c1, "remember", 1, skill="recall"),
                self._q("quiz", c2, "apply", 2, fmt="text", skill="explain"),
            ]
            qs += [self._q("final", c1, "apply", 2), self._q("final", c2, "analyze", 3, skill="compare")]
            return {"segments": [
                {"title": "الفكرة", "markdown": "المكدس بنية بيانات تعمل بمبدأ آخر داخل أول خارج [ص 1]. " * 3, "pages": [1], "concept_ids": [c1]},
                {"title": "مثال", "markdown": "```python\nstack.append(1)\n```\nمثال من الشريحة [ص 2] وصفحة غير موجودة [ص 999]. " * 2, "pages": [2, 999], "concept_ids": [c2]},
            ], "questions": qs}
        if "needs help" in prompt:
            self.calls["teach_again"] += 1
            cids = re.findall(r"(t\d+c\d+) \(", prompt) or ["t1c1"]
            n = int(re.search(r"\[ (\d+) NEW questions", prompt).group(1)) if "NEW questions" in prompt else 0
            return {"markdown": "شرح بطريقة مختلفة مع تشبيه طابور المطعم [ص 1]", "pages": [1], "questions": [self._q("quiz", cids[0], "apply", 2) for _ in range(n)]}
        if "NEW exam questions" in prompt:
            self.calls["more"] += 1
            n = int(re.search(r"Write (\d+) NEW", prompt).group(1))
            cid = re.findall(r"- (t\d+c\d+):", prompt)[0]
            pool = re.search(r'"pool": "(\w+)"', prompt).group(1)
            return {"questions": [self._q(pool, cid, "apply", 2) for _ in range(n)]}
        if "You grade" in prompt:
            self.calls["grade"] += 1
            ok = "صحيح" in prompt.split("<<<")[1]
            return {"score": 1.0 if ok else 0.2, "verdict": "correct" if ok else "incorrect", "misconception": "" if ok else "فهم ناقص", "missing_concepts": [], "feedback": "تقييم"}
        if "and asks a question" in prompt:
            self.calls["ask"] += 1
            return {"markdown": "الجواب من المحاضرة [ص 1]", "pages": [1], "in_lecture": True}
        raise AssertionError("unexpected prompt: " + prompt[:80])
