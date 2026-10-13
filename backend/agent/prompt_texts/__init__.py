"""Static system-prompt texts, kept as Markdown files next to this module.

Edit the .md files to change what Faten is told; agent/prompts.py only
decides which texts to include and adds the student's live data.
A file's single trailing newline is not part of the text.
"""

from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=None)
def prompt_text(name: str) -> str:
    raw = (_DIR / f"{name}.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    return raw[:-1] if raw.endswith("\n") else raw
