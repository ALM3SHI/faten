"""
API contract: the routes the frontend and the installed apps depend on.

`api_contract.json` lists every route (method + path) and, for each, the
names of its request fields and of the fields in its JSON response model.
The test fails when the live app differs, so a route cannot be removed,
renamed or reshaped by accident during a refactor.

A deliberate API change is fine — re-record the file and commit it with the
change, so the reviewer sees exactly what moved:

    API_CONTRACT_UPDATE=1 python -m pytest tests/test_api_contract.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import main

CONTRACT_FILE = Path(__file__).parent / "api_contract.json"


def _resolve(schema: dict, components: dict) -> dict:
    """Follow a `$ref` once (FastAPI puts every model under components)."""
    ref = schema.get("$ref")
    if ref:
        return components.get(ref.rsplit("/", 1)[-1], {})
    return schema


def _fields(schema: dict | None, components: dict) -> list[str]:
    if not schema:
        return []
    return sorted(_resolve(schema, components).get("properties", {}))


def current_contract() -> dict[str, dict]:
    spec = main.app.openapi()
    components = spec.get("components", {}).get("schemas", {})
    contract: dict[str, dict] = {}
    for path, operations in sorted(spec["paths"].items()):
        for method, op in sorted(operations.items()):
            body = op.get("requestBody", {}).get("content", {})
            body_schema = next((c.get("schema") for c in body.values()), None)
            ok = op.get("responses", {}).get("200", {}).get("content", {}).get("application/json", {})
            contract[f"{method.upper()} {path}"] = {
                "params": sorted(f"{p['in']}:{p['name']}" for p in op.get("parameters", [])),
                "body": _fields(body_schema, components),
                "response": _fields(ok.get("schema"), components),
            }
    return contract


def test_api_matches_the_recorded_contract():
    live = current_contract()
    if os.environ.get("API_CONTRACT_UPDATE") == "1":
        CONTRACT_FILE.write_text(json.dumps(live, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return

    recorded = json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))
    removed = sorted(set(recorded) - set(live))
    added = sorted(set(live) - set(recorded))
    changed = sorted(k for k in set(live) & set(recorded) if live[k] != recorded[k])
    problems = (
        [f"removed: {r}" for r in removed]
        + [f"added (record it): {a}" for a in added]
        + [f"changed: {c}\n    was {recorded[c]}\n    now {live[c]}" for c in changed]
    )
    assert not problems, (
        "The API no longer matches tests/api_contract.json:\n  "
        + "\n  ".join(problems)
        + "\nIf this is intended, re-record with API_CONTRACT_UPDATE=1 and commit the file."
    )


def test_contract_covers_every_route_group():
    """Guards the recorded file itself against being truncated or emptied."""
    recorded = json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))
    for prefix in ("/api/chat", "/api/workspace", "/api/advisor", "/api/tutor", "/api/community", "/api/notifications", "/health"):
        assert any(prefix in route for route in recorded), f"no route recorded under {prefix}"
    assert len(recorded) >= 50
