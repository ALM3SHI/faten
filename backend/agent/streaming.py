"""
Turn a streamed Chat Completions response back into the same shape as a
non-streamed one, while forwarding text deltas as they arrive.

The agent loop stays identical for both modes: it receives an object with
`.choices[0].message.content / .tool_calls` and `.choices[0].finish_reason`.

Tool-call deltas are merged by `index`. Provider-specific extras on a tool
call (Gemini 3 sends `extra_content.google.thought_signature`) are kept
verbatim, because the next request must echo them back unchanged.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Awaitable, Callable

TokenCallback = Callable[[str], Awaitable[None]]


def _as_dict(obj: Any) -> dict:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    dump = getattr(obj, "model_dump", None)
    return dump(exclude_none=True) if dump else dict(vars(obj))


def _deep_merge(dst: dict, src: dict) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_merge(dst[k], v)
        else:
            dst[k] = v


class StreamedToolCall:
    """Mimics openai's ChatCompletionMessageToolCall for the agent loop."""

    def __init__(self, data: dict):
        self._data = data
        self.id = data.get("id")
        self.type = data.get("type", "function")
        fn = data.get("function") or {}
        self.function = SimpleNamespace(name=fn.get("name") or "", arguments=fn.get("arguments") or "")

    def model_dump(self, exclude_none: bool = True) -> dict:
        return dict(self._data)


class ToolCallAccumulator:
    def __init__(self) -> None:
        self._calls: dict[int, dict] = {}

    def add(self, delta_tool_calls: Any) -> None:
        for pos, tc in enumerate(delta_tool_calls or []):
            d = _as_dict(tc)
            idx = d.pop("index", None)
            if idx is None:
                idx = pos
            entry = self._calls.setdefault(idx, {"type": "function", "function": {"name": "", "arguments": ""}})
            fn = d.pop("function", None) or {}
            if fn.get("name"):
                # Some providers resend the full name on every chunk.
                if not entry["function"]["name"].endswith(fn["name"]):
                    entry["function"]["name"] += fn["name"]
            if fn.get("arguments"):
                entry["function"]["arguments"] += fn["arguments"]
            extra_fn = {k: v for k, v in fn.items() if k not in ("name", "arguments")}
            if extra_fn:
                _deep_merge(entry["function"], extra_fn)
            if d.get("id"):
                entry["id"] = d.pop("id")
            d.pop("type", None)
            _deep_merge(entry, d)  # e.g. extra_content.google.thought_signature

    def result(self) -> list[StreamedToolCall]:
        out = []
        for idx in sorted(self._calls):
            data = self._calls[idx]
            data.setdefault("id", f"call_{idx}")
            out.append(StreamedToolCall(data))
        return out


async def collect_stream(stream: Any, on_token: TokenCallback | None) -> SimpleNamespace:
    """Consume a streamed completion; return a non-streamed-looking object."""
    text: list[str] = []
    tools = ToolCallAccumulator()
    finish_reason = None
    usage = None
    async for chunk in stream:
        if getattr(chunk, "usage", None):
            usage = chunk.usage
        for choice in getattr(chunk, "choices", None) or []:
            delta = getattr(choice, "delta", None)
            if delta is not None:
                piece = getattr(delta, "content", None)
                if piece:
                    text.append(piece)
                    if on_token:
                        await on_token(piece)
                if getattr(delta, "tool_calls", None):
                    tools.add(delta.tool_calls)
            if getattr(choice, "finish_reason", None):
                finish_reason = choice.finish_reason
    tool_calls = tools.result()
    if tool_calls and finish_reason in (None, "stop"):
        finish_reason = "tool_calls"  # some providers report "stop" even with tool calls
    message = SimpleNamespace(content="".join(text) or None, tool_calls=tool_calls or None, role="assistant")
    return SimpleNamespace(
        choices=[SimpleNamespace(message=message, finish_reason=finish_reason or "stop")],
        usage=usage,
    )
