"""
JSON Schemas for the tutor's model calls (Gemini structured output).

With a schema the reply is constrained while it is generated, so it cannot
come back as broken JSON (unescaped quotes in shell commands, missing commas).
Code still validates every value (questions.py, ingest.py): a schema fixes
the shape, not the meaning. Kept small and flat on purpose — very large or
deeply nested schemas can be rejected by the API.
"""

_STR = {"type": "string"}
_INT = {"type": "integer"}
_STRS = {"type": "array", "items": _STR}
_INTS = {"type": "array", "items": _INT}

QUESTION = {
    "type": "object",
    "properties": {
        "pool": {"type": "string", "enum": ["check", "quiz", "final"]},
        "segment": _INT,
        "format": {"type": "string", "enum": ["choice", "text", "code"]},
        "skill": {"type": "string", "enum": ["recall", "explain", "predict", "apply", "debug", "compare", "write_code"]},
        "bloom": {"type": "string", "enum": ["remember", "understand", "apply", "analyze"]},
        "difficulty": _INT,
        "concept_ids": _STRS,
        "prompt": _STR,
        "options": _STRS,
        "answer_index": _INT,
        "option_feedback": _STRS,
        "misconceptions": _STRS,
        "model_answer": _STR,
        "accepted_answers": _STRS,
        "rubric": _STR,
        "hints": _STRS,
        "explanation": _STR,
        "pages": _INTS,
    },
    "required": ["pool", "format", "skill", "bloom", "difficulty", "concept_ids", "prompt", "hints", "explanation"],
}

LESSON = {
    "type": "object",
    "properties": {
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": _STR, "markdown": _STR, "pages": _INTS, "concept_ids": _STRS},
                "required": ["title", "markdown", "pages"],
            },
        },
        "questions": {"type": "array", "items": QUESTION},
    },
    "required": ["segments", "questions"],
}

QUESTIONS = {"type": "object", "properties": {"questions": {"type": "array", "items": QUESTION}}, "required": ["questions"]}

TEACH = {
    "type": "object",
    "properties": {"markdown": _STR, "pages": _INTS, "questions": {"type": "array", "items": QUESTION}},
    "required": ["markdown", "pages"],
}

GRADE = {
    "type": "object",
    "properties": {
        "score": {"type": "number"},
        "verdict": {"type": "string", "enum": ["correct", "partial", "incorrect"]},
        "misconception": _STR,
        "missing_concepts": _STRS,
        "feedback": _STR,
    },
    "required": ["score", "verdict", "feedback"],
}

ASK = {
    "type": "object",
    "properties": {"markdown": _STR, "pages": _INTS, "in_lecture": {"type": "boolean"}},
    "required": ["markdown", "pages", "in_lecture"],
}

STRUCTURE = {
    "type": "object",
    "properties": {
        "title": _STR,
        "overview": _STR,
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": _STR,
                    "pages": _INTS,
                    "summary": _STR,
                    "objectives": _STRS,
                    "concepts": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"name": _STR, "definition": _STR}, "required": ["name", "definition"]},
                    },
                    "prerequisites": _INTS,
                    "importance": _INT,
                    "est_minutes": _INT,
                    "has_code": {"type": "boolean"},
                    "key_terms": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"term": _STR, "definition": _STR}, "required": ["term", "definition"]},
                    },
                },
                "required": ["title", "pages", "objectives", "concepts"],
            },
        },
        "unclear_pages": _INTS,
    },
    "required": ["title", "overview", "topics"],
}

VISION = {
    "type": "object",
    "properties": {
        "pages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"index": _INT, "text": _STR, "visual": _STR, "readable": {"type": "boolean"}},
                "required": ["index", "text", "visual", "readable"],
            },
        }
    },
    "required": ["pages"],
}
