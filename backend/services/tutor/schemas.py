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
        "format": {"type": "string", "enum": ["choice", "text", "code", "order", "match", "fill"]},
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
        "steps": _STRS,
        "pairs": _STRS,
        "rubric": _STR,
        "hints": _STRS,
        "explanation": _STR,
        "pages": _INTS,
    },
    "required": ["pool", "format", "skill", "bloom", "difficulty", "concept_ids", "prompt", "hints", "explanation"],
}

# One picture per lesson part, described in text (the model draws nothing):
# nodes/edges are short lines parsed by services/tutor/visuals.py, which keeps
# this schema flat.
VISUAL = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["diagram", "photo", "slide", "steps", "none"]},
        "steps": _STRS,
        "layout": {"type": "string", "enum": ["row", "stack"]},
        "caption": _STR,
        "diagram_type": {"type": "string", "enum": ["flow", "sequence", "cycle"]},
        "direction": {"type": "string", "enum": ["lr", "tb"]},
        "nodes": _STRS,
        "edges": _STRS,
        "queries": _STRS,
        "page": _INT,
    },
    "required": ["kind"],
}

PART_ROLES = ["idea", "why", "how", "example", "real_world", "code", "mistake", "compare", "summary"]

PART = {
    "type": "object",
    "properties": {
        "role": {"type": "string", "enum": PART_ROLES},
        "origin": {"type": "string", "enum": ["lecture", "added"]},
        "markdown": _STR,
        "pages": _INTS,
    },
    "required": ["role", "origin", "markdown"],
}

LESSON = {
    "type": "object",
    "properties": {
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": _STR, "parts": {"type": "array", "items": PART}, "markdown": _STR, "pages": _INTS, "concept_ids": _STRS, "visual": VISUAL},
                "required": ["title", "parts", "pages"],
            },
        },
        "questions": {"type": "array", "items": QUESTION},
        "video": {"type": "object", "properties": {"queries": _STRS}},
    },
    "required": ["segments", "questions"],
}

DEEP_DIVE = {
    "type": "object",
    "properties": {"parts": {"type": "array", "items": PART}, "related": _STRS},
    "required": ["parts"],
}

# The quality review: for each numbered "from the lecture" part, is it supported by the pages?
REVIEW = {
    "type": "object",
    "properties": {
        "parts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"index": _INT, "supported": {"type": "boolean"}, "unsupported": _STR},
                "required": ["index", "supported"],
            },
        },
        # the reviewer's own answers to the lesson's objective questions
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"index": _INT, "choice": _INT, "order": _INTS, "matches": _INTS, "text": _STR},
                "required": ["index"],
            },
        },
    },
    "required": ["parts"],
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
