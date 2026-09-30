# Loop & graph patterns

A **loop** is one agent repeating OBSERVE → DECIDE → ACT → MEASURE → {ACCEPT | REPAIR | ESCALATE | STOP}.
A **graph** connects loops: nodes (agent / tool / validator / human), edges (routing, fan-out, fan-in, loop-back), shared state.
Pick the smallest shape that covers the failure surface. Over-nodularizing is a real failure mode: more nodes = more cost and more places for state to drift.

## Harness levels (add a level only when the failure surface earns it)

| Level | Adds | Use when |
| :- | :- | :- |
| L0 | prompt + model | one-shot, cheap to redo, human reads the result |
| L1 | contract, map, tools | task has a definition of done or a large context |
| L2 | durable state, evidence gate, bounded loop | more than a few turns, or "done" can be faked |
| L3 | permissions, traces, recovery, human gates, verifier, fresh-context resets | unattended, long horizon, external side effects, or money/data at risk |

## Single-agent loops

| ID | Pattern | Mechanism in Claude Code | Stop rule | Fits |
| :- | :- | :- | :- | :- |
| P1 | **Gate loop** (build until evidence passes) | `stop_gate.py` Stop hook, or `/goal` quoting verify.sh output | gate pass / cap / same failure ×3 | bug fix, feature to spec, refactor with tests, doc that must satisfy a schema |
| P2 | **Fresh-context outer loop** (Ralph with a gate) | `run_loop.sh`: new `claude -p` per iteration, continuity only in files + git | gate pass / cap / same failure | work larger than one context window, overnight backlogs, migrations |
| P3 | **Watcher loop** | `/loop <interval>` or self-paced `/loop`, Monitor for streams, `.claude/loop.md` | external condition met (PR merged, queue empty) | CI babysitting, deploy watch, inbox/queue draining |
| P4 | **Scheduled / event loop** | Routine (`/schedule`, API, GitHub trigger) + gate inside each run | per-run gate; routine lives until disabled | triage, dependency upgrades, docs drift, reports |
| P5 | **Metric climb** (optimize a number) | P1 or P2 with verify.sh asserting a threshold; keep a `best` in state.json; revert regressions | threshold reached / no improvement in K rounds | Lighthouse ≥90, latency, bundle size, eval score |

## Graph patterns (multi-agent)

| ID | Topology | Mechanism | Fits | Template |
| :- | :- | :- | :- | :- |
| G1 | **Builder → Verifier** (separate worker from judge) | main session builds; `<slug>-verifier` subagent or agent Stop hook disproves | any task where self-review would share the builder's blind spots | `verifier-agent.md` |
| G2 | **Planner → Generator → Evaluator** (sprint contracts) | planner writes contract + chunks; generator loops P1 per chunk; evaluator grades with calibrated rubric | long app builds, multi-feature work | P1 per chunk + G1 |
| G3 | **Fix-until-green graph** | workflow: measure → repair → measure, no-progress detector, final verifier | CI/type/lint repair, flaky suites | `workflows/fix-until-green.js` |
| G4 | **Fan-out / refute / converge** | workflow `pipeline(items, work, refute)` with diverse lenses, merge survivors | audits, 100-file migrations, research with cross-checked sources | `workflows/fanout-refute-converge.js` |
| G5 | **Tournament / judge panel** | N isolated attempts from different angles → gate → judge panel → graft | wide solution space: design, copy, architecture, hard bugs | `workflows/tournament.js` |
| G6 | **Loop-until-dry discovery** | finders in rounds, dedup against *all seen*, stop after K empty rounds | unknown-size discovery (bugs, edge cases, leads) | see primitives.md workflow notes |
| G7 | **Peer team** | agent teams with shared task list; `TaskCompleted` / `TeammateIdle` hooks as gates | a few long-running specialists that must talk (frontend/backend/test) | – |
| G8 | **Proactive composite** | Routine (trigger) → `/goal` (per-item completion) → workflow (parallel attempts) → PR (human gate) | recurring streams of well-defined work | launch.md §F |

## Selection guide

1. **Can "done" be proven by a command?** yes → gate loop (P1/P2) with deterministic verify.sh. no → define the rubric, use G1 (verifier) and put the judge last.
2. **Does it fit in one context window?** no → P2 fresh-context loop, or G2 chunks.
3. **What starts the next iteration?** the last turn → P1 · time → P3 · an external event or schedule → P4 · a list of items → G4.
4. **Is the solution space wide / first attempts converge to bland defaults?** → G5 tournament.
5. **Are there many independent items?** → G4 with `pipeline()` (not a barrier), worktree isolation only if items edit files in parallel.
6. **Side effects outside the workspace?** → L3: guard `ask_commands`, draft/PR instead of publish, human approval node.

## Rules that keep graphs honest
- Every critical path has at least one **non-probabilistic** node (tests, schema, query, compiler). Three copies of the same model agreeing is a chorus, not an ensemble.
- Verifiers get **different inputs or lenses** (and ideally a different model) from builders; their prompt asks "what makes this unacceptable?".
- Sequential gates can short-circuit (cheap checks first); parallel judges cost the full N every time.
- Shared state has one writer per field (builder writes `state.json`; gate writes `iteration`/signatures; verifier writes nothing).
- `log()` anything a workflow drops or samples: silent caps read as full coverage.
- Every edge that loops back carries a cap. Every run carries a budget (iterations, wall clock, `--max-budget-usd`, agent count).
- Re-test components when the model changes: each component encodes an assumption about what the model can't do; delete the ones that stopped being load-bearing.
