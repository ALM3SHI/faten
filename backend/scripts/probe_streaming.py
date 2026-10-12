"""
Live check of streaming against the real Gemini API (run locally, not in CI).

    cd backend
    python scripts/probe_streaming.py

Uses the same client and stream-assembly code as the server and prints only
timings and structure — never the API key or the thought-signature bytes.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent.streaming import collect_stream  # noqa: E402
from config import get_settings  # noqa: E402
from services.llm import make_llm_client  # noqa: E402

TOOL = {
    "type": "function",
    "function": {
        "name": "get_day_schedule",
        "description": "محاضرات الطالب في يوم معيّن",
        "parameters": {"type": "object", "properties": {"day": {"type": "string"}}, "required": []},
    },
}


async def timed(client, model, messages, tools=None):
    first = None
    count = 0
    start = time.perf_counter()

    async def on_token(_t):
        nonlocal first, count
        count += 1
        if first is None:
            first = time.perf_counter() - start

    kwargs = dict(model=model, messages=messages, max_tokens=1024)
    if tools:
        kwargs.update(tools=tools, tool_choice="auto")
    stream = await client.chat.completions.create(stream=True, **kwargs)
    result = await collect_stream(stream, on_token)
    return result, first, count, time.perf_counter() - start


async def main() -> int:
    s = get_settings()
    print(f"provider={s.ai_provider} model={s.llm_model} fast={s.llm_fast_model} key_set={bool(s.llm_api_key)}")
    client = make_llm_client()
    ok = True
    for model in (s.llm_model, s.llm_fast_model):
        print(f"\n=== {model} ===")
        # 1) plain text streaming
        try:
            r, first, n, total = await timed(client, model, [{"role": "user", "content": "اكتب ثلاث جمل قصيرة عن جامعة أم القرى."}])
            print(f"[1] text: first_token={first and round(first, 2)}s chunks={n} total={total:.2f}s finish={r.choices[0].finish_reason} chars={len(r.choices[0].message.content or '')}")
            ok &= n > 1
        except Exception as e:
            print(f"[1] FAILED: {type(e).__name__}: {str(e)[:300]}")
            ok = False
            continue

        # 2) tool call while streaming
        msgs = [
            {"role": "system", "content": "استخدم الأداة للإجابة عن الجدول."},
            {"role": "user", "content": "وش عندي محاضرات بكرة؟"},
        ]
        try:
            r, first, n, total = await timed(client, model, msgs, [TOOL])
            msg = r.choices[0].message
            calls = [tc.model_dump() for tc in (msg.tool_calls or [])]
            print(f"[2] tool: finish={r.choices[0].finish_reason} calls={len(calls)} total={total:.2f}s")
            for c in calls:
                keys = sorted(c.keys())
                sig = bool(((c.get("extra_content") or {}).get("google") or {}).get("thought_signature"))
                print(f"    name={c['function']['name']} args={c['function']['arguments']} keys={keys} thought_signature={sig}")
            if not calls:
                print("    (model answered without calling the tool)")
                continue
        except Exception as e:
            print(f"[2] FAILED: {type(e).__name__}: {str(e)[:300]}")
            ok = False
            continue

        # 3) send the tool result back — fails here if the signature was lost
        msgs.append({"role": "assistant", "content": msg.content or "", "tool_calls": calls})
        for c in calls:
            msgs.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(
                {"success": True, "weekday": "الثلاثاء", "lectures": [{"course": "تعلم الآلة", "start": "10:00", "end": "11:50"}]},
                ensure_ascii=False)})
        try:
            r, first, n, total = await timed(client, model, msgs, [TOOL])
            print(f"[3] answer: first_token={first and round(first, 2)}s chunks={n} total={total:.2f}s")
            print(f"    text={(r.choices[0].message.content or '')[:160]!r}")
            ok &= bool(r.choices[0].message.content)
        except Exception as e:
            print(f"[3] FAILED: {type(e).__name__}: {str(e)[:300]}")
            ok = False

    await client.close()
    print("\nRESULT:", "OK ✅" if ok else "PROBLEM ❌")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
