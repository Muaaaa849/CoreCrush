# Launch — {{SLUG}}

> harness-forge が選んだ起動方法を 1 つだけ残し、他の節は削除する。
> どの方法でも: 契約 = `contract.yaml`、完了判定 = `verify.sh` (+ `{{SLUG}}-verifier`)、状態 = `state.json`。

## A. Stop-gate loop (interactive, deterministic gate)
```text
! python3 .harness/bin/harnessctl.py activate {{SLUG}} --gate stop
Read .harness/{{SLUG}}/prompt.md and follow it until the harness releases you.
```
- 推奨: auto mode (無人で回す) か、必要コマンドを allow ルールに入れておく。
- 途中で止める: `! python3 .harness/bin/harnessctl.py deactivate {{SLUG}}`

## B. /goal (interactive or `claude -p`, lightweight)
```text
/goal `bash .harness/{{SLUG}}/verify.sh` has been run in this turn and its output ends with "HARNESS_VERIFY: PASS"; contract.yaml, verify.sh and harness.json are unchanged (git diff shows no change to them); or stop after {{MAX_ITERATIONS}} turns. Work per .harness/{{SLUG}}/prompt.md.
```
- /goal の評価モデルはツールを使わず会話だけを読むため、条件は「会話に出力された証拠」で書く。

## C. Fresh-context outer loop (long horizon / overnight, headless)
```bash
HARNESS_PERMISSION_MODE=acceptEdits HARNESS_BUDGET_USD=5 .harness/bin/run_loop.sh {{SLUG}} {{MAX_ITERATIONS}}
```
- 各イテレーションは新しいセッション。継続性は state.json / lessons.md / git にだけ存在する。

## D. Time-based (/loop) — 外部状態を見張る仕事
```text
/loop 15m Read .harness/{{SLUG}}/prompt.md, do one iteration, run verify.sh; when it prints HARNESS_VERIFY: PASS, write receipt.md and stop the loop.
```
- 間隔は「見張る対象が変化する速さ」に合わせる。間隔を省略すると Claude が 1分〜1時間で自己調整。

## E. Dynamic workflow (fan-out / graph)
```text
Use a workflow for .harness/{{SLUG}}: <pattern from reference/patterns.md>. Gate the final result with bash .harness/{{SLUG}}/verify.sh.
```

## F. Routine (cloud, schedule / API / GitHub event)
```text
/schedule <cadence>: Read .harness/{{SLUG}}/prompt.md in this repo and run one iteration; open a PR, never push to main. /goal: verify.sh prints HARNESS_VERIFY: PASS or stop after N turns.
```
- クラウドは新規クローンで動く: `.harness/{{SLUG}}` をコミットしておくこと。
