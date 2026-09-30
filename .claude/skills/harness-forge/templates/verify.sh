#!/usr/bin/env bash
# Evidence gate for harness "{{SLUG}}".  PROTECTED: the builder cannot edit this file.
#
# Rules
#  - Exit 0 only when every done_when item in contract.yaml has passing evidence.
#  - Deterministic checks first (syntax -> types -> focused tests -> integration -> visual/semantic).
#    Never ask a model what a compiler, test, schema or query can prove.
#  - One line per check: "PASS <id> <name>" / "FAIL <id> <name>" + indented evidence tail.
#  - Must be read-only with respect to the work product, and fast enough to run every iteration.
#  - Last line is always "HARNESS_VERIFY: PASS" or "HARNESS_VERIFY: FAIL" (the /goal evaluator reads it).
set -u
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 2
FAILED=0

# check <id> <name> <command...>   run a command; non-zero exit = FAIL
check() {
  local id="$1" name="$2"; shift 2
  local out
  if out=$("$@" 2>&1); then echo "PASS $id $name"
  else echo "FAIL $id $name"; printf '%s\n' "$out" | tail -n 25 | sed 's/^/    /'; FAILED=1; fi
}

# tier <label>   stop before expensive tiers when a cheaper tier already failed
tier() { [ "$FAILED" -eq 0 ] || { echo "SKIP remaining tiers (earlier tier failed) at: $1"; finish; }; }

# judge <id> <rubric-file> <artifact-path> [model]
#   LLM-as-judge for "judgment" items ONLY (weakest evidence; keep it last). Runs a fresh, tool-less
#   session with a disproof-oriented rubric. Use a different model than the builder when you can.
judge() {
  local id="$1" rubric="$2" artifact="$3" model="${4:-}"
  local args=(-p --output-format text) verdict
  [ -n "$model" ] && args+=(--model "$model")
  verdict=$(HARNESS_NESTED=1 claude "${args[@]}" "You are a strict, independent reviewer. Your job is to find what would make this artifact UNACCEPTABLE, not to confirm it looks good.
Rubric:
$(cat "$rubric")

Artifact ($artifact):
$(cat "$artifact")

Answer with exactly one first line: 'VERDICT: PASS' or 'VERDICT: FAIL', then at most 10 lines of concrete reasons citing the artifact." 2>&1)
  if printf '%s\n' "$verdict" | head -n 3 | grep -q 'VERDICT: PASS'; then echo "PASS $id judge($(basename "$rubric"))"
  else echo "FAIL $id judge($(basename "$rubric"))"; printf '%s\n' "$verdict" | head -n 12 | sed 's/^/    /'; FAILED=1; fi
}

finish() {
  if [ "$FAILED" -eq 0 ]; then echo "HARNESS_VERIFY: PASS"; exit 0; fi
  echo "HARNESS_VERIFY: FAIL"; exit 1
}

# ---------------------------------------------------------------- checks
# Replace the TODO below with real checks mapped 1:1 to contract.yaml done_when ids.
tier "structure"
check D0 "placeholder - replace me" false   # TODO: e.g. check D1 "unit tests" npm test --silent

tier "behaviour"
# check D2 "focused test" pytest -q tests/test_feature.py

tier "judgment"
# judge D3 .harness/{{SLUG}}/rubric.md docs/report.md

finish
