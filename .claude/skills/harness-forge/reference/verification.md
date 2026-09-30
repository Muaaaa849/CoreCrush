# Verification design

The model creates the artifact. The environment creates evidence about it. The harness decides whether the evidence is sufficient.
"Done" from the model is just another model output.

## 1. From done_when to checks (1:1)

For every `done_when` item write: **claim → evidence → check → kind**.

| Claim | Evidence | Check in verify.sh | Kind |
| :- | :- | :- | :- |
| bug is fixed | the failing repro test now passes | `check D1 "repro" pytest -q tests/test_bug_123.py` | deterministic |
| nothing else broke | full suite passes | `check D2 "suite" npm test --silent` | deterministic |
| page works | browser flow completes | `check D3 "e2e" npx playwright test flows/checkout.spec.ts` | deterministic |
| layout unchanged on mobile | pixel diff under threshold | `check D4 "visual" node scripts/visual-diff.js --max 0.5%` | visual |
| data is correct | values match source | `check D5 "reconcile" python scripts/reconcile.py --source db --target out.csv` | deterministic |
| migration is safe | dry run + rollback pass | `check D6 "dry-run" ./migrate --dry-run && ./migrate --rollback --dry-run` | deterministic |
| report answers the question with sources | every claim cites a fetched source | `check D7 "citations" python scripts/cite_check.py report.md` then `judge D8 rubric.md report.md` | deterministic + judgment |
| tone fits the brand | rubric score | `judge D9 .harness/x/rubric.md draft.md` | judgment |

Order: syntax → types → focused tests → integration → visual/semantic → human approval. Use `tier` to stop before expensive tiers.
Never ask a model what a compiler, test, schema or query can prove. Use models for judgment, deterministic systems for facts.

## 2. Non-code goals still get deterministic checks
Most "fuzzy" goals have a deterministic skeleton; check it before any judge:
- **Writing**: word count range, required sections present (`grep -c '^## '`), no banned phrases, links resolve (`curl -sI`), reading-level script, spell-check.
- **Research**: each claim has a URL, each URL was actually fetched (trace), quotes appear verbatim in the fetched text, ≥N independent sources per key claim, date of sources ≥ cutoff.
- **Data/analysis**: schema validation, row counts reconcile, totals match source, notebook runs top-to-bottom, chart file exists.
- **Design/UI**: screenshot exists per viewport, axe/lighthouse score, no console errors, visual diff threshold.
- **Ops/triage**: every item in the queue has a label/owner/response (query the API), nothing left untouched.

## 3. Judges (when judgment is unavoidable)
- Last tier only; one rubric file per judged item, with **pass/fail anchors and examples** (calibrate: an evaluator that approves mediocre work is the common failure; read its outputs and tighten the rubric).
- Weight the criteria the model is weakest at (e.g. originality over polish for design).
- Prompt for disproof: "Find what would make this unacceptable. Default to FAIL if evidence is missing."
- Independence: fresh context, not the builder's transcript; different model when possible (`judge ... <model>`); different lenses when using several judges.
- Output a fixed first line (`VERDICT: PASS|FAIL`) so the gate can parse it.

## 4. The builder may not grade itself — anti reward-hacking
- `verify.sh`, `contract.yaml`, `harness.json`, `.harness/bin/*`, settings are **protected** by `guard.py`.
- Add test files and fixtures that define correctness to `extra_protected_paths` when the task is "make tests pass" (otherwise the cheapest fix is to weaken the test).
- The verifier subagent looks specifically for weakened/skipped tests, special-cased inputs, scope creep, and claims without evidence.
- Keep a **held-out** check the builder never sees when the target is a metric (e.g. a second test set run only by verify.sh from a path outside the map).
- The gate reads exit codes, not the model's summary. The receipt lists only what the gate or verifier proved.

## 5. Proving the gate before trusting it
Run `harnessctl.py check <slug>`, then confirm:
1. **Red baseline**: verify fails on the current state for the right reason (otherwise the task is already done or the check is vacuous).
2. **Sensitivity**: a deliberately broken variant still fails (mutate one thing mentally or in a scratch copy).
3. **Coverage**: every `done_when` id appears in verify.sh or in the verifier's item list.
4. **Speed**: fast enough to run every iteration (move slow suites to a later tier or a final verifier pass).
5. **Determinism**: two runs on the same state give the same verdict (flaky gates cause blind retries).
6. **No false blockers from the environment**: scope checks ("only these paths changed") must ignore harness and runtime
   artifacts (`.harness/`, logs, `__pycache__`, build output) — prefer `git diff --name-only <base>` on tracked files plus an
   allow-list for new files. A gate that fails on something the builder is not allowed to fix produces a guaranteed
   same-failure escalation (observed in testing: a runner log in the repo root blocked an otherwise-correct run).
7. **No answer leaks**: reference solutions and mutated variants used to test the gate live outside the repo and are deleted.
