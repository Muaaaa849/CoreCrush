#!/usr/bin/env bash
# Self-test for harness-forge runtime: scaffolds a harness in a temp git repo and drives the hooks
# with synthetic hook-input JSON. No model calls. usage: bash scripts/selftest.sh
set -euo pipefail
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cd "$T"; git init -q; export CLAUDE_PROJECT_DIR="$T"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }
expect() { if printf '%s' "$2" | grep -q -- "$3"; then ok "$1"; else bad "$1 (got: $2)"; fi; }

python3 "$SKILL/scripts/bin/harnessctl.py" init demo --objective "make answer.txt contain 42" --max-iterations 4 >/dev/null
python3 "$SKILL/scripts/bin/harnessctl.py" install-hooks >/dev/null
cat > .harness/demo/verify.sh <<'EOF'
#!/usr/bin/env bash
cd "$CLAUDE_PROJECT_DIR"
if grep -qx 42 answer.txt 2>/dev/null; then echo "PASS D1 answer"; echo "HARNESS_VERIFY: PASS"; exit 0; fi
echo "FAIL D1 answer"; echo "    answer.txt=$(cat answer.txt 2>/dev/null || echo missing)"; echo "HARNESS_VERIFY: FAIL"; exit 1
EOF
B=.harness/bin
stop() { echo "{\"hook_event_name\":\"Stop\",\"cwd\":\"$T\",\"stop_hook_active\":${1:-false},\"background_tasks\":${2:-[]}}" | python3 $B/stop_gate.py; }
pre()  { echo "$1" | python3 $B/guard.py; }

# inactive -> everything no-ops
expect "inactive stop gate is a no-op" "$(stop)x" "^x$"
expect "inactive guard is a no-op" "$(pre '{"tool_name":"Edit","tool_input":{"file_path":"'"$T"'/.harness/demo/verify.sh"}}')x" "^x$"

python3 $B/harnessctl.py activate demo --gate stop >/dev/null
expect "settings has stop hook" "$(cat .claude/settings.local.json)" "stop_gate.py"
expect "block cap env set" "$(cat .claude/settings.local.json)" "CLAUDE_CODE_STOP_HOOK_BLOCK_CAP"

# fail -> block with evidence
expect "fail blocks stop" "$(stop)" '"decision": "block"'
expect "fail feeds evidence" "$(stop true)" "answer.txt=missing"
# 3rd identical failure -> escalate
expect "same failure x3 escalates" "$(stop true)" "STOP: the identical failure repeated 3"
expect "escalated then released" "$(stop true)" "stopped"
[ ! -f .harness/ACTIVE ] && ok "ACTIVE cleared after release" || bad "ACTIVE still present"

# progress resets the same-failure counter; pass -> receipt turn -> release
python3 $B/harnessctl.py activate demo >/dev/null
stop >/dev/null; echo 41 > answer.txt
expect "different failure is not 'same'" "$(stop true)" "iteration 2/4"
echo 42 > answer.txt
expect "pass asks for receipt" "$(stop true)" "Evidence gate PASSED"
expect "then releases as done" "$(stop true)" "done"
expect "gate.json is done" "$(cat .harness/demo/gate.json)" '"status": "done"'
expect "state.json untouched by gate" "$(cat .harness/demo/state.json)x" '^[^i]*"slug"'
# builder scribbling a counter into state.json must not affect the gate
python3 $B/harnessctl.py activate demo >/dev/null
python3 -c "import json;p='.harness/demo/state.json';s=json.load(open(p));s['iteration']=99;json.dump(s,open(p,'w'))"
expect "gate counts independently of state.json" "$(stop)" "iteration 1/4"
python3 $B/harnessctl.py deactivate demo >/dev/null

# iteration cap
rm answer.txt; python3 $B/harnessctl.py activate demo >/dev/null
for i in 1 2 3; do echo $i > answer.txt; stop >/dev/null; done
echo 9 > answer.txt
expect "iteration cap escalates" "$(stop)" "iteration cap reached (4/4)"
stop >/dev/null

# background work defers the gate
python3 $B/harnessctl.py activate demo >/dev/null
expect "background task defers" "$(stop false '[{"id":"t1","type":"shell","status":"running"}]')x" "^x$"

# guard policy
expect "edit verify.sh denied" "$(pre '{"tool_name":"Edit","tool_input":{"file_path":"'"$T"'/.harness/demo/verify.sh"}}')" '"deny"'
expect "edit contract denied" "$(pre '{"tool_name":"Write","tool_input":{"file_path":"'"$T"'/.harness/demo/contract.yaml"}}')" '"deny"'
expect "edit work file allowed" "$(pre '{"tool_name":"Edit","tool_input":{"file_path":"'"$T"'/answer.txt"}}')x" "^x$"
expect "sed -i on verify.sh denied" "$(pre '{"tool_name":"Bash","tool_input":{"command":"sed -i s/1/0/ .harness/demo/verify.sh"}}')" '"deny"'
expect "running verify.sh with 2>&1 | tail allowed" "$(pre '{"tool_name":"Bash","tool_input":{"command":"bash .harness/demo/verify.sh 2>&1 | tail -20"}}')x" "^x$"
expect "cat verify.sh > /dev/null allowed" "$(pre '{"tool_name":"Bash","tool_input":{"command":"cat .harness/demo/verify.sh >/dev/null"}}')x" "^x$"
expect "redirect into verify.sh denied" "$(pre '{"tool_name":"Bash","tool_input":{"command":"echo exit 0 > .harness/demo/verify.sh"}}')" '"deny"'
expect "tee into gate.json denied" "$(pre '{"tool_name":"Bash","tool_input":{"command":"echo {} | tee .harness/demo/gate.json"}}')" '"deny"'
expect "edit gate.json denied" "$(pre '{"tool_name":"Write","tool_input":{"file_path":"'"$T"'/.harness/demo/gate.json"}}')" '"deny"'
expect "reading verify.sh allowed" "$(pre '{"tool_name":"Bash","tool_input":{"command":"bash .harness/demo/verify.sh"}}')x" "^x$"
expect "force push denied" "$(pre '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}')" '"deny"'
expect "self-deactivation denied" "$(pre '{"tool_name":"Bash","tool_input":{"command":"python3 .harness/bin/harnessctl.py deactivate demo"}}')" '"deny"'
expect "git push asks" "$(pre '{"tool_name":"Bash","tool_input":{"command":"git push origin feat"}}')" '"ask"'
expect "npm test allowed" "$(pre '{"tool_name":"Bash","tool_input":{"command":"npm test"}}')x" "^x$"

# session context re-injection
expect "session start injects state" "$(echo '{"hook_event_name":"SessionStart","source":"compact"}' | python3 $B/session_context.py)" "active harness"

# nested judge sessions never re-enter the gate
expect "HARNESS_NESTED disables gate" "$(echo '{}' | HARNESS_NESTED=1 python3 $B/stop_gate.py)x" "^x$"

# trace + check
expect "trace recorded gate events" "$(cat .harness/demo/trace.jsonl)" "gate_fail"
expect "check flags unfilled contract" "$(python3 $B/harnessctl.py check demo || true)" "contract.yaml still contains TODO"
sed -i 's/TODO/filled/g' .harness/demo/contract.yaml
expect "check validates harness" "$(python3 $B/harnessctl.py check demo || true)" '"ok": true'

echo "---"; echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
