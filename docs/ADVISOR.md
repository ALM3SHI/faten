# المرشد الأكاديمي — Academic Decision & Planning Engine

`/advisor` in the app, `/api/advisor/*` on the server, `get_academic_plan` in the chat agent.

It answers one question: **given this student's record, what is the best next academic decision, and why?** All
scheduling, eligibility, GPA and risk logic is deterministic Python; the language model only rewords results, and
its output is rejected if it leaves the computed facts.

## What it does

| Capability | How | Where |
|---|---|---|
| Official study plans as data | captured from uqu.edu.sa, validated, versioned, with provenance | `backend/knowledge/catalog/uqu/` |
| Student profile | every attempt, repeats, W/IC/IP/NP/DN, per-term GPA, gaps | `services/advisor/profile.py` |
| Degree audit | done / in progress / failed / remaining; outside-plan courses | `services/advisor/audit.py` |
| Multi-term planner | list scheduling on the prerequisite graph under hard constraints | `services/advisor/planner.py` |
| Scenarios | fastest · balanced · recovery, each with graduation term and assumptions | `planner.py`, `recommend.py` |
| Graduation-date check | provable earliest term (chain length vs. credits ÷ capacity) | `planner.lower_bound` |
| Next-term advice | reasons, what each course unlocks, *measured* delay cost of postponing it | `recommend.analyze` |
| Load advice | from the student's recent terms (labelled as a Faten planning rule, not regulation) | `recommend.recommended_load` |
| Risks | separated into **fact** (from the record) and **estimate** | `recommend.detect_risks` |
| GPA what-if | exact arithmetic, not prediction | `recommend.gpa_what_if` |
| Schedule check | proposed registration vs. prerequisites, co-op, summer cap, min load | `planner.validate_schedule` |
| Major comparison | overlap, grades in the program's main areas, fastest completion, stated interests | `services/advisor/majors.py` |
| Instructor evidence | replaceable providers; shrinkage, recency, disagreement; no pick without evidence | `services/advisor/instructors.py` |
| Explanations | deterministic 6-question summary; optional LLM follow-ups, validated | `services/advisor/explain.py` |

## Data sources — verified

| Source | Status | Notes |
|---|---|---|
| `uqu.edu.sa/App/Degrees/{id}` (Arabic plan) and `/en/App/Degrees/{id}/{course}` (prerequisites) | **verified, integrated** for 4 programs | Server-rendered; behind a Cloudflare browser challenge, so plain HTTP clients are refused. Captured in a real browser with `capture_degree.js`; every raw snapshot is stored with its SHA-256. |
| Programs integrated | CS `478` (137 h), AI `1490` (132 h), SE `1510` (134 h), Computer & Network Eng. `1492` (158 h) | College of Computing, Makkah. The catalog lists **337** programs; the pipeline handles any of them (see below). |
| Study & exam regulations (executive rules) | **verified**, already in `knowledge/regulations/` | Min load 10 h, summer max 10 h, prerequisites required, co-op exclusive, IC blocks dependents, GPA over all attempts, warnings, graduation floor, 20 % retake rule, transfer rules. |
| Course workload/difficulty | existing verified `course_reviews` (students who took the course) | Used only with ≥ 5 reviews. |
| Qaym (qaym.com) | **not integrated** | No public API or data-use permission found; origin returned Cloudflare 522 on 2026-10-14. `QaymProvider` reports this and returns nothing. |

### Official documents cross-checked (`backend/knowledge/catalog/uqu/documents.json`)

Each entry stores URL, SHA-256 of the exact file, version/date, retrieval date and the facts copied from it.
`services/advisor/evidence.py` compares them with the plan snapshots: agreement → evidence on the plan entry;
new detail → added beside the plan data with its source; conflict → an Issue (the plan is never overwritten).

| Document | Applies to | Result |
|---|---|---|
| [Executive study & exam rules](https://uqu.edu.sa/App/Regulations/1480) (last modified 2026-07-13) | all | Live page = repo copy (423/424 paragraphs; the extra one is the footer). No regular-term maximum load anywhere. |
| [Department programs page](https://uqu.edu.sa/App/Degrees?dept=1&faculty=14) | CS 478, AI 1490 | Totals 137 / 132 confirmed. |
| Prep-year programs 2195 / 2196 / 2200 | CS, AI, SE | Identical to levels 1–2 of each plan (codes and hours 35 / 36 / 36). |
| [CS3809 specification](https://drive.uqu.edu.sa/_/ccomp_csai/files/8489c1d4-98af-4555-9883-9f682862812a.pdf) v1.0, rev. 22/4/2025 | CS 478 | Level 5, 3 h, required, prerequisites DS2201 + SE1201 — agrees with the plan. |
| [AI3501 specification](https://drive.uqu.edu.sa/_/ccomp_csai/files/126df5c2-8730-47de-ae82-c46f125177c8.pdf) v1.0, rev. 2 Jan 2025 | AI 1490 | Level 6, 3 h, AI3101 + SE1201 — agrees; adds **«Department Approval»**. |
| AI4107, AI4205, AI4207, AI4208, AI4209, AI4308 specifications | AI 1490 | Documented **elective options** (partial list); AI4209 has co-requisite AI3202. |
| CS Program Manual (Plan 44, 201 h), AI Handbook 2023 (Plan 44, 185 h), SE Guidebook 2023-24 (181 h) | — | **Not applicable** to the current plans; used only to recognise a record from an older edition. |

### Known gaps in the official data (shown to students, never filled in)

* **Unlisted electives.** Each plan page lists fewer hours than the program total (CS 126/137, AI 124/132,
  SE 120/134, CE 147/158). The missing hours are planned as generic elective slots marked *unavailable*.
* **AND/OR of multiple prerequisites** is not shown; all are treated as required (marked *inferred*).
* **Semester offerings** are not public (only in the registration system). Plans are *mathematically feasible,
  not confirmed for registration*. Students can mark a course «not offered» and the planner respects it.
* **Plan edition** is not shown on the page. A student on an older plan is compared with the current one; the
  confidence note says so. New snapshots become new curriculum versions (old ones are kept).
* **Regular-term maximum load** is not in the executive rules (re-checked 2026-10-14). 18 h is a Faten planning
  default (rule `default_max_regular_load`, kind *default*), never presented as regulation.
* **Program graduation GPA** is set per program by the University Council and is not published for these
  programs. Graduation and academic warning are modelled separately; a warning is stated as fact only when the
  GPA is below 1.00 (the «مقبول» floor no program can go under) or below a threshold the student entered.
  Otherwise the status is shown as *unknown* — no universal 2.00 is assumed.
* **Electives:** only the AI program has documented options, and they are a partial list; elective hours stay
  unnamed slots in every plan.
* **Plan editions:** older editions (Plan 44) are documented; a record matching one is flagged and confidence
  drops to *low*.
* The prerequisite cards on course pages show the *dependent* course's hours; the ingest detects and ignores this.

## Deterministic rules

Hard (a plan that breaks one is never produced; covered by a 40-student randomised property test × 3 strategies):
prerequisites passed in an earlier term · «not offered» terms · load ≤ cap (summer ≤ 10) · co-op alone · IC blocks.

Soft (reported, not hidden): regular load ≥ 10 except when graduating or nothing is eligible · heavy-course limit
per strategy (fastest none, balanced 2, recovery 1; *heavy* = ≥ 5 verified reviews averaging ≥ 4/5, or failed before).

GPA = Σ(points × credits) / Σ credits over **all graded attempts** (F and DN count as 0; W, IP, NP, IC, NF excluded).
When the transcript states a GPA, it wins and any difference is shown.

Reproducibility: every run has an `inputs_fingerprint` over the record, settings, curriculum snapshot hash, review
stats, start term and engine version. Same inputs → same result and the same run id.

## Data model

```
knowledge/catalog/uqu/catalog.json
  university                  UQU
  courses{code}               shared definition (names, credits if consistent, programs it appears in)
  programs{id}                uqu-478 …  → curricula[] (chronological versions)
  curricula{id}               uqu-478@2026-10-14: provenance, stated/listed/unlisted hours,
                              courses[{code, level, credits, prerequisites, kind, verification}], issues[]
Firestore
  users/{uid}/academic_record/main        read only (official parsed transcript)
  users/{uid}/advisor/settings            the student's goals + labelled manual corrections
  users/{uid}/advisor_runs/{run_id}       results (server-written; rules block client writes)
  course_reviews/{CODE}                   existing verified course reviews (read)
  instructor_reviews/{CODE}/reviews/{id}  verified instructor reviews (server-only)
```

Prerequisites live on the **curriculum** entry, not the shared course: the official site lists `DS2201` with no
prerequisite in CS but `CS1012` in AI.

## Adding programs or another university

1. Open any page on `uqu.edu.sa` in a browser, paste `backend/knowledge/catalog/uqu/capture_degree.js` into the
   console, run `await captureDegree(<id>, {statedTotalHours: <h>})`, and save the pipe-separated export as
   `raw/degree-<id>.psv` (the same format as the existing files; the program id and total hours are in the
   «برامج الجامعة» search results).
2. `cd backend && python -m services.advisor.ingest_uqu` (or `--check` to validate only). Errors exit non-zero.
3. Commit the raw file and the regenerated `catalog.json`.

Another university needs its own `knowledge/catalog/<id>/` and an ingest module producing the same `Catalog`
model; the engine does not change.

## Running and verifying locally

```bash
cd backend
python -m services.advisor.ingest_uqu --check          # catalog integrity
python -m pytest tests/test_advisor.py tests/test_advisor_api.py
python -m pytest                                        # whole suite

cd ../frontend
npm run typecheck && npm run lint && npm test
npm run build:e2e && npx playwright test e2e/advisor.spec.ts
```

Then run the backend and frontend as usual and open **سجلي → المرشد** (`/advisor`). Upload a transcript first
(`/transcript`) or the advisor will say it has no record.

`python scripts/advisor_e2e_fixture.py` regenerates the Playwright fixture from the real engine.

## Limits to be honest about

* Four programs integrated, not all 337. The pipeline is generic, but each program needs a browser capture.
* Instructor recommendations will say «no recommendation» until enough verified reviews exist — by design.
* «Department Approval» (AI3501) cannot be checked; plans assume it will be granted and say so.
* Prep-year students: registration of prep levels is automatic per regulation; the plan for those terms is
  informational, and the schedule checker does not flag prerequisites inside the prep year.
* No labour-market data; the major comparison says so explicitly.
* The LLM layer is optional; without an API key the deterministic summary is used.
