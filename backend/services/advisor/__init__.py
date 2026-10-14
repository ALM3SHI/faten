"""Academic decision & planning engine («المرشد الأكاديمي»).

Layers (each one only depends on the ones above it):

  catalog     — official study plans as data, with provenance and
                verification status (knowledge/catalog/<university>/).
  rules       — registration regulations, each rule citing its article.
  profile     — the student's record → attempts, GPA, standing, gaps.
  audit       — record × curriculum → done / in progress / remaining.
  planner     — deterministic multi-term scheduling under hard constraints.
  recommend   — next-term choice, scenarios, risks, confidence.
  majors      — evidence-based program comparison.
  instructors — replaceable evidence providers + honest aggregation.
  explain     — optional LLM wording, validated against the facts.

Nothing here writes to the student's academic record.
"""
