# Claude Code loop primitives (verified 2026-09-29, Claude Code v2.1.284)

Source: official docs at code.claude.com/docs/en/{goal,scheduled-tasks,hooks,workflows,routines,sub-agents,agent-teams,skills}
and the bundled `/workflow-authoring` skill. Re-check these pages when the installed version is much newer.

## Choose by "what starts the next turn" and "who decides done"

| Primitive | Next turn starts when | Done is decided by | Survives session end | Best for |
| :- | :- | :- | :- | :- |
| Plain turn / skill | user prompt | the working model (weakest) | – | exploration, short tasks |
| `/goal <cond>` | previous turn ends | separate small model (Haiku) reading the **transcript only** | restored on resume | verifiable end state, low setup |
| Stop hook `command` | previous turn ends | **your script** (deterministic) | settings-scoped | hard evidence gates (this skill's `stop_gate.py`) |
| Stop hook `prompt` / `agent` | previous turn ends | model; `agent` can Read/Grep/Glob (≤50 turns, experimental) | settings-scoped | fuzzy criteria, file inspection |
| `/loop [interval] <prompt>` | time interval (fixed cron, or self-paced 1m–1h) | you / Claude (`ScheduleWakeup stop`) | session-scoped, 7-day expiry | watching external state (CI, deploys, PRs) |
| Monitor tool | each line of a background script's output | – | session-scoped | event streams instead of polling |
| Dynamic workflow | the **script** (JS) | the script + verifier agents | resumable in same session | fan-out, graphs, 10–1000 agents |
| Agent teams | lead assigns; shared task list | lead + `TaskCompleted`/`TeammateIdle` hooks | teammates keep running | a few long-running peers that talk |
| Routine (`/schedule`) | cron (≥1h) / API POST / GitHub event | the run's own gate | yes (cloud, fresh clone) | recurring, unattended, event-driven |
| Headless outer loop (`claude -p` in bash) | your shell loop | your shell loop | yes (process) | multi-context-window work, overnight |

## /goal
- `/goal <condition ≤4000 chars>` sets and immediately starts; `/goal` shows status (turns, tokens, last reason); `/goal clear`.
- One goal per session. Evaluator verdicts: not-met (keep going, reason becomes guidance) / met / impossible.
- **Evaluator does not run tools.** Write the condition as evidence Claude must print, e.g.
  "`bash .harness/x/verify.sh` output ends with HARNESS_VERIFY: PASS". Include constraints and a bound ("or stop after 20 turns").
- Stops by itself if Claude answers without tool use for several turns. Background work defers evaluation; check-ins after 30 min
  (`CLAUDE_CODE_GOAL_CHECKIN_MINUTES`, 0 disables). Works with `claude -p "/goal ..."` (use `--output-format stream-json --verbose` to watch).
- Unattended requires auto mode or allow rules. Unavailable when hooks are disabled (`disableAllHooks`, managed-only hooks).

## Stop hooks (the programmable gate)
- Input includes `stop_hook_active`, `last_assistant_message`, `background_tasks[]`, `session_crons[]`.
- Output `{"decision":"block","reason":"..."}` → Claude continues with `reason` as its instruction.
  `hookSpecificOutput.additionalContext` continues as non-error feedback.
- **Cap: 8 consecutive continuations**, then Claude Code forces the stop. Raise with env `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`
  (harnessctl `install-hooks --block-cap N` writes it into settings `env`).
- If background tasks are running, prefer letting the stop happen: their completion wakes the session.
- Hook types: `command`, `http`, `mcp_tool`, `prompt` (`{"ok","reason","impossible"}`), `agent` (tools, 60s default timeout).
- Skills and subagents can declare hooks in frontmatter (`hooks:`); skill hooks stay registered for the rest of the session (`once: true` to remove after first success).
- `PreToolUse` → `hookSpecificOutput.permissionDecision: allow|deny|ask|defer` is how policy lives outside the model.
- `SessionStart` (matchers startup|resume|compact|clear) → `additionalContext` re-injects durable state after compaction.

## /loop and scheduling
- `/loop 5m <prompt>` fixed; `/loop <prompt>` self-paced (Claude picks 1m–1h, prints reason); bare `/loop` runs the maintenance prompt or `.claude/loop.md` / `~/.claude/loop.md` (≤25 KB, re-read every iteration).
- A skill can be the prompt: `/loop 20m /review-pr 1234` (not if `disable-model-invocation: true`).
- Esc cancels a self-paced wakeup. Self-paced loops end via `ScheduleWakeup(stop: true)`; a missed reschedule gets one ~20 min fallback.
- Tools: `CronCreate/CronList/CronDelete`, `ScheduleWakeup`, `Monitor` (stream a background script's output; often cheaper than polling).
- Match the interval to how fast the watched thing changes. Minimums: /loop 1 min, Desktop tasks 1 min, cloud routines 1 h.

## Dynamic workflows
- Ask "use a workflow …" or include `ultracode`; `/effort ultracode` makes Claude plan workflows for every substantive task (costly).
- Script API: `agent(prompt, {label, phase, schema, model, effort, isolation:'worktree', agentType})`,
  `parallel([() => agent(...)])` (barrier, failures → null), `pipeline(items, stage1, stage2…)` (no barrier; default),
  `phase(title)`, `log(msg)`, global `args`, `budget.total/remaining()`. `export const meta = {name, description, phases}` must be a pure literal.
- No `Date.now()`, `Math.random()`, `import()`, file or shell access in the script (agents do the work). Deterministic replay makes runs resumable.
- Limits: 16 concurrent agents (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`), 4096 items per call, 1000 agents per run; "Large workflow" warning >25 agents or >1.5M tokens.
- `/workflows` to watch/pause/stop; press `s` to save as `.claude/workflows/<name>.js` (runs as `/<name>`). Load `/workflow-authoring` before editing a script.
- Built-in example: `/deep-research`.

## Subagents (`.claude/agents/<name>.md`)
- Frontmatter: `name`, `description` (required), `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`,
  `mcpServers`, `hooks`, `memory` (user|project|local), `background`, `effort`, `isolation: worktree`, `omitClaudeMd`, `initialPrompt`.
- A verifier subagent = fresh context + read-only tools + disproof prompt. Its `Stop` hook becomes `SubagentStop`.

## Routines (cloud)
- `/schedule <description>` (alias `/routines`) or claude.ai/code/routines. Triggers: schedule (≥1h, or one-off), API POST with bearer token, GitHub events.
- Runs on a fresh clone with no permission prompts, scoped connectors; daily run cap per account. Commit the harness files so the clone has them.
- Loop writes to a branch / draft PR, never to main: the PR review is the human gate.

## Skills (this file's container)
- Frontmatter: `description` (+`when_to_use`, ≤1536 chars total in listing), `argument-hint`, `arguments`, `allowed-tools`,
  `disallowed-tools`, `disable-model-invocation`, `user-invocable`, `model`, `effort`, `context: fork` + `agent`, `hooks`, `paths`.
- Substitutions: `$ARGUMENTS`, `$0..$N`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`;
  `` !`cmd` `` injects command output before Claude reads the skill.

## Headless
- `claude -p "<prompt>" --permission-mode <mode> --output-format stream-json --verbose --max-budget-usd <n> --model <m> --effort <e>`
- Project hooks (Stop gate, guard, SessionStart) **do fire** in `-p` sessions (verified). Nested `claude -p` judges must set
  `HARNESS_NESTED=1` so they don't re-enter the gate.
