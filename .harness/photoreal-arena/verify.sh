#!/usr/bin/env bash
# Evidence gate for harness "photoreal-arena".  PROTECTED: the builder cannot edit this file.
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
SHOTS=.harness/photoreal-arena/shots
export CHROMIUM_PATH=${CHROMIUM_PATH:-/opt/pw-browsers/chromium}

tier "D1 型・データ・テスト"
check D1a "typecheck" npm run -s typecheck
check D1b "validate:data" npm run -s validate:data
check D1c "npm test（不変条件を含む）" npx vitest run --reporter=dot

tier "D4-D6 調査・ポスト・ライブラリ（安い決定論）"
check D4 "調査メモ（見出し・出典 15 以上）" node -e '
const fs=require("fs"); const p="docs/research/graphics-compositing.md";
if(!fs.existsSync(p)) throw new Error(p+" がない");
const s=fs.readFileSync(p,"utf8");
for (const h of ["ライブラリ","コンポジット","採否"]) if(!new RegExp("^#+ .*"+h,"m").test(s)) throw new Error("見出し「"+h+"」がない");
const n=new Set(s.match(/https?:\/\/[^\s)>\]]+/g)||[]).size; if(n<15) throw new Error("出典 URL が "+n+" 個（15 以上）");'
check D5 "post 一式（data/render.json）" node -e '
const r=JSON.parse(require("fs").readFileSync("data/render.json","utf8"));
const need=["vignette","edgeBlur","chromaticAberration","grain","lensFlare","lightLeak","grade","dust"];
const miss=need.filter(k=>!(r.post&&k in r.post)); if(miss.length) throw new Error("post に無い: "+miss.join(", "));'
check D8 "プランナー確定（フェンスにノイズなし・持った球は暗い）" node -e '
const fs=require("fs"); const f=fs.readFileSync("src/vfx/plasmaFence.ts","utf8");
if(/mx_\w*noise|triNoise|noise\w*\(/i.test(f)) throw new Error("フェンスにノイズ関数がある（プランナー確定に反する）");
const c=JSON.parse(fs.readFileSync("data/vfx/coreFace.json","utf8")); if(c.heldDim>0.25) throw new Error("heldDim="+c.heldDim+"（持った球が眩しくなる）");'
check D6 "three-bvh-csg を使っている" bash -c 'grep -q "\"three-bvh-csg\"" package.json && grep -rqE "from .three-bvh-csg." src/'

tier "D2-D3 描画・負荷"
check D2a "公開用ページのビルド" npm run -s proto:gh-pages
check D2b "5 視点の撮影（エラーなし）" bash -c "rm -rf $SHOTS && node .harness/photoreal-arena/capture.mjs $SHOTS >/dev/null && node -e '
const m=JSON.parse(require(\"fs\").readFileSync(\"$SHOTS/meta.json\",\"utf8\"));
if(Object.keys(m.views).length!==5) throw new Error(\"視点が 5 つでない\");
if(m.errors.length) throw new Error(m.errors.join(\"\\n\"));'"
check D3 "描画負荷（drawCalls ≤ 400・triangles ≤ 2.5M）" node -e '
const m=JSON.parse(require("fs").readFileSync(process.argv[1]+"/meta.json","utf8"));
const bad=Object.entries(m.views).filter(([,v])=>v.drawCalls>400||v.triangles>2500000).map(([k,v])=>k+": "+v.drawCalls+" calls, "+v.triangles+" tris");
console.log(JSON.stringify(m.views)); if(bad.length) throw new Error(bad.join("\n"));' "$SHOTS"

tier "D7 盲検評価（Sonnet 5.5・独立 3 回）"
check D7 "SSS 級の 80% 以上（中央値）・主要物が読める" node .harness/photoreal-arena/judge.mjs "$SHOTS" 3

finish
