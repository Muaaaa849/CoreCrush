# Worked examples (one per shape)

Each shows: profile → chosen shape → the parts that matter. Everything else comes from the templates.

---
## 1. "Fix the duplicate-coupon bug" — code, deterministic, one session
Profile: verifiability=deterministic · horizon=session · trigger=now · items=1 · risk=reversible
Shape: **L2 · P1 gate loop (Stop gate) + G1 verifier at the end**
```yaml
done_when:
  - {id: D1, claim: repro test passes, evidence: "pytest tests/test_coupon_dup.py", kind: deterministic}
  - {id: D2, claim: nothing else broke, evidence: "pytest -q", kind: deterministic}
  - {id: D3, claim: no test weakened, evidence: "verifier inspects git diff tests/", kind: judgment}
```
verify.sh: `tier structure; check D0 lint ruff check .; tier behaviour; check D1 ...; check D2 ...`
harness.json: `"extra_protected_paths": ["tests/test_coupon_dup.py"]` (write the repro test first, then protect it).
Launch: A (activate + prompt). Finish: run `<slug>-verifier`; its FAIL feeds another round.

---
## 2. "Migrate 300 components from JS to TS" — many items, deterministic per item
Profile: deterministic · horizon > one context · items=300 · risk=reversible (branch)
Shape: **L3 · G4 fan-out workflow per directory, then P1 gate on the whole repo**
- Workflow: discover files → `pipeline(files, migrate (isolation: worktree only if they collide), tsc-check-file)` → converge.
- verify.sh: `tsc --noEmit`, `npm test`, and `test $(git ls-files 'src/**/*.js' | wc -l) -eq 0`.
- Pilot on one directory first to measure cost; set workflow size guideline; budget in contract.

---
## 3. "Write a market research report on X" — research, judgment-heavy
Profile: judgment + deterministic skeleton · horizon=session · risk=read-only
Shape: **L2 · G4 (fan-out search → refute → converge) or `/deep-research`, gated by P1**
verify.sh:
```bash
check D1 "sections" python3 -c "import re,sys;t=open('report.md').read();sys.exit(0 if all(s in t for s in ['## Summary','## Market size','## Competitors','## Risks','## Sources']) else 1)"
check D2 "every claim cited" python3 .harness/x/cite_check.py report.md   # each paragraph has [n] and n exists in Sources
check D3 "sources fresh" python3 .harness/x/dates.py report.md --since 2026-01-01
tier judgment
judge D4 .harness/x/rubric.md report.md          # rubric: answers the question? unsupported leaps? missing counter-evidence?
```
Verifier lens: "find a claim whose source doesn't say that".

---
## 4. "Keep my PR green and answer reviews until merged" — external state
Profile: deterministic (CI) · trigger=time/events · horizon=days · risk=external (push)
Shape: **L3 · P3 watcher (`/loop` self-paced) or P4 routine on GitHub events**
- `.claude/loop.md` = prompt.md (one iteration: read CI + review threads, fix, push to the PR branch only).
- Guard: `git push` is `ask` by default — for this harness move the PR branch push to allowed by adding an allow rule, keep force-push denied.
- Stop: PR merged/closed → `ScheduleWakeup stop`. Interval follows CI duration, not a fixed 1m.

---
## 5. "Get the homepage Lighthouse score ≥ 90" — metric climb
Profile: deterministic metric · horizon=session · risk=reversible
Shape: **L2 · P5 metric climb via `/goal` (low setup)**
```text
/goal `bash .harness/lh/verify.sh` output ends with HARNESS_VERIFY: PASS (performance ≥ 90 on 3 consecutive runs, no visual diff > 0.5%); never edit verify.sh; or stop after 12 turns
```
state.json keeps `best_score` + the commit; verify.sh reverts nothing (read-only) — the prompt says "revert changes that lower the score".

---
## 6. "Every morning, triage new support tickets" — recurring stream
Profile: mixed · trigger=schedule · risk=external (replies)
Shape: **L3 · G8 proactive composite: routine → per-ticket gate → draft replies → human approval**
- Routine prompt: iterate tickets since last run (stored in state.json committed to a branch), label + draft reply; never send.
- verify.sh (API query): every new ticket has a label, an owner and a draft; nothing sent.
- Receipt posted to the team channel; a human sends the drafts.

---
## 7. "Design three landing-page directions and pick the best" — wide solution space
Profile: judgment + visual · items=3 attempts · risk=reversible
Shape: **L2 · G5 tournament** (`workflows/tournament.js`): isolated attempts from different angles → gate (build passes, screenshots at 3 viewports, no console errors) → judge panel with a calibrated design rubric (originality weighted over polish) → graft.

---
## 8. "Clear the 120-issue 'good first issue' backlog overnight" — long horizon
Profile: deterministic per issue · horizon=hours · items=many · risk=reversible (PR per issue)
Shape: **L3 · P2 fresh-context outer loop** (`run_loop.sh`), one issue per iteration; state.json holds the queue and per-issue status;
verify.sh passes when the queue is empty and every PR's CI is green. `HARNESS_BUDGET_USD` per iteration and `max_iterations` bound spend.
