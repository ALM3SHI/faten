"""Per-call context handed to every agent tool handler."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolContext:
    tool_name: str
    user_id: str
    db: Any
    #: users/{uid} document reference
    user_ref: Any
    #: UTC timestamp of the call, ISO-8601
    now_iso: str
