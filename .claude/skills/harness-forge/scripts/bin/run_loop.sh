#!/usr/bin/env bash
# Fresh-context outer loop (Ralph-style, with an evidence gate and stop rules).
#
# Each iteration is a brand-new `claude -p` session, so context never rots; continuity lives in
# .harness/<slug>/state.json, lessons.md, the repo and git history. The loop, not the model,
# decides "done": it runs verify_cmd after every iteration.
#
# usage: .harness/bin/run_loop.sh <slug> [max_iterations]
# env:   HARNESS_PERMISSION_MODE (default acceptEdits)   HARNESS_MODEL (optional)
#        HARNESS_BUDGET_USD per iteration (optional)     HARNESS_EFFORT (optional)
#        HARNESS_EXTRA_ARGS extra flags for claude (e.g. '--allowedTools "Bash(npm test*)"')
set -uo pipefail

slug="${1:?usage: run_loop.sh <slug> [max_iterations]}"
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root"
hdir=".harness/$slug"
[ -d "$hdir" ] || { echo "no harness at $hdir" >&2; exit 2; }

cfg() { python3 -c "import sys,json;sys.path.insert(0,'.harness/bin');import hlib;print(hlib.load_config(__import__('pathlib').Path('.'),'$slug')['$1'])"; }
max="${2:-$(cfg max_iterations)}"
max_same="$(cfg max_same_failure)"
verify_cmd="$(cfg verify_cmd)"

# The stop gate is for interactive sessions; the outer loop is the gate here.
python3 .harness/bin/harnessctl.py activate "$slug" --gate none >/dev/null

last_sig=""; same=0
for ((i = 1; i <= max; i++)); do
  echo "=== [harness:$slug] iteration $i/$max ==="
  prompt="$(cat "$hdir/prompt.md")

--- iteration $i/$max ---
Durable state = .harness/$slug/state.json (read it now; update that exact file before you finish):
$(cat "$hdir/state.json")
Recent lessons:
$(tail -n 30 "$hdir/lessons.md" 2>/dev/null)
Last verifier output:
$(tail -n 60 "$hdir/last_verify.txt" 2>/dev/null || echo '(first iteration)')"

  args=(-p "$prompt" --permission-mode "${HARNESS_PERMISSION_MODE:-acceptEdits}" --output-format stream-json --verbose)
  [ -n "${HARNESS_MODEL:-}" ] && args+=(--model "$HARNESS_MODEL")
  [ -n "${HARNESS_EFFORT:-}" ] && args+=(--effort "$HARNESS_EFFORT")
  [ -n "${HARNESS_BUDGET_USD:-}" ] && args+=(--max-budget-usd "$HARNESS_BUDGET_USD")
  # shellcheck disable=SC2086
  claude "${args[@]}" ${HARNESS_EXTRA_ARGS:-} >>"$hdir/session-$i.jsonl" 2>&1
  echo "{\"event\":\"iteration_end\",\"iteration\":$i,\"exit\":$?}" >>"$hdir/trace.jsonl"
  python3 -c "import sys;sys.path.insert(0,'.harness/bin');import hlib,pathlib;r=pathlib.Path('.');g=hlib.load_gate(r,'$slug');g['iteration']=$i;hlib.save_gate(r,'$slug',g)"

  if bash -c "$verify_cmd" >"$hdir/last_verify.txt" 2>&1; then
    echo "[harness:$slug] evidence gate PASSED at iteration $i"
    echo "{\"event\":\"gate_pass\",\"iteration\":$i}" >>"$hdir/trace.jsonl"
    claude -p "The harness .harness/$slug passed its evidence gate. Write .harness/$slug/receipt.md (OBJECTIVE / CHANGED / VERIFIED / NOT VERIFIED / RISKS / APPROVAL NEEDED / HARNESS LESSONS) using this verifier output as evidence:
$(tail -n 60 "$hdir/last_verify.txt")" --permission-mode acceptEdits >/dev/null 2>&1
    python3 .harness/bin/harnessctl.py deactivate "$slug" --status done >/dev/null
    exit 0
  fi

  sig="$(tail -n 60 "$hdir/last_verify.txt" | python3 -c 'import sys;sys.path.insert(0,".harness/bin");import hlib;print(hlib.failure_signature(sys.stdin.read()))')"
  if [ "$sig" = "$last_sig" ]; then same=$((same + 1)); else same=1; last_sig="$sig"; fi
  echo "{\"event\":\"gate_fail\",\"iteration\":$i,\"signature\":\"$sig\",\"same\":$same}" >>"$hdir/trace.jsonl"
  if [ "$same" -ge "$max_same" ]; then
    echo "[harness:$slug] STOP: identical failure $same times in a row - escalate to a human" >&2
    python3 .harness/bin/harnessctl.py deactivate "$slug" --status stopped >/dev/null
    exit 3
  fi
done

echo "[harness:$slug] STOP: iteration cap $max reached without passing the gate" >&2
python3 .harness/bin/harnessctl.py deactivate "$slug" --status stopped >/dev/null
exit 4
