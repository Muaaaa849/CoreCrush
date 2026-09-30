# Recovery policy & self-improvement

## Classify before retrying ("try again" just pays to reproduce the failure)

| Failure class | Signal | Action |
| :- | :- | :- |
| TOOL_TIMEOUT | timeout, 5xx, rate limit | retry with backoff (the gate does not count infra noise as progress) |
| INVALID_ARGS | schema/usage error | repair the call; if recurring, fix the tool contract / add an example to map.md |
| MISSING_CONTEXT | "can't find", wrong file, invented API | retrieve via map.md; then add the missing pointer to map.md |
| FAILED_CHECK | a verify.sh check fails | inspect the failing *behaviour*, not the check; smallest fix |
| PERMISSION_DENIED | guard deny / ask | request approval or pick a reversible alternative (draft, branch, PR) |
| CONFLICTING_REQUIREMENTS | constraints can't all hold | stop, write the conflict to receipt APPROVAL NEEDED |
| UNCHANGED_REPEATED_FAILURE | same failure signature ×`max_same_failure` | stop — the gate escalates automatically |
| NO_PROGRESS | metric/failing-count not improving for K rounds | change approach (tournament) or stop |
| BUDGET | iteration / time / spend cap | stop with a receipt; never extend the budget from inside the loop |

Every loop has limits on attempts, time, spend and destructive scope. Knowing when another attempt is not worth it is part of the harness.

## Make every failure improve the harness

| Failure | Harness fix (not just an output fix) |
| :- | :- |
| missing context | add a line to `map.md` (or a CLAUDE.md pointer) |
| wrong tool / misuse | tighten the tool contract, add an allow rule or a wrapper script |
| bad output slipped through | add a check to `verify.sh` or a rubric item |
| loop went in circles | lower `max_same_failure`, add a no-progress detector |
| unsafe action attempted | add to `extra_deny_commands` / `extra_ask_commands` |
| lost decision after compaction/restart | persist it in `state.json.decisions` |
| couldn't tell what happened | add a trace field / log line |

Promotion ladder — each recurring lesson moves one step down:
**explanation → checklist → template → automated check → enforced policy.**
The prompt explains judgment; the harness enforces invariants. Eventually the environment remembers the lesson for the model.

## Self-improvement loop (after runs)
1. Read `receipt.md`, `lessons.md`, and `trace.jsonl` (gate_fail signatures, policy_deny, repeated tools).
2. Cluster failures by class (weakness mining). Ignore one-offs; act on patterns.
3. Propose **bounded** harness edits, each with: evidence (trace lines) → root cause → edit → predicted effect.
4. Validate: re-run the gate on the last good state (must still pass) and on a known-bad state (must still fail). Keep the verifier read-only while evolving the builder side, so gains come from real changes, not a softer judge.
5. Apply, and note it in `lessons.md` with its ladder level.
6. When the model is upgraded, try deleting components (sprints, per-step evaluators, resets); keep only what is still load-bearing.

## Receipts
Humans review a receipt, not a transcript: OBJECTIVE · RESULT · CHANGED · VERIFIED (with evidence) · NOT VERIFIED · RISKS · APPROVAL NEEDED · HARNESS LESSONS · RUN STATS.
It summarizes what the harness can prove, which makes it usable for review, handoff and the next session.
