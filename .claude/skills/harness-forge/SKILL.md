---
name: harness-forge
description: 達成したい「目的」から、Claude Code 上で自律的に回る最適なループハーネスを設計・生成・検証する汎用スキル。目的をタスク契約(done_when)に変換し、タスク特性から /goal・Stop hook ゲート・/loop・routine・dynamic workflow(グラフ)・fresh-context headless ループ等の最小十分な構成を選び、検証ゲート(verify.sh)・独立 verifier・権限ポリシー・外部状態・トレース・レシート・自己改善までを実ファイルとして生成して動作確認する。
when_to_use: ユーザーが目的を自律的・反復的に達成させたいとき — "ハーネスを作って", "ループを組んで", "放置で終わらせたい", "夜通し回したい", "完了まで回して", "自己改善ループ", "定期実行", "agentic graph", "harness", "build a loop for", "run until done", "overnight". コード以外(調査・執筆・運用・データ)の目的にも使う。
argument-hint: "<目的> [--mode auto|stop-gate|goal|headless|loop|workflow|routine] [--launch]"
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/bin/harnessctl.py *) Bash(bash ${CLAUDE_SKILL_DIR}/scripts/selftest.sh) Bash(python3 .harness/bin/harnessctl.py *) Bash(bash .harness/*/verify.sh)
---

# harness-forge — 目的 → 最高のループハーネス

目的: $ARGUMENTS

プロンプトは 1 回の応答を良くする。ハーネスは **毎回の実行** を良くする。
このスキルの仕事は、目的を直接こなすことではなく、**目的を確実に達成させる環境 (harness) を作って証明すること**。
ハーネス = モデルが「何を見られるか・何ができるか・何を覚えるか・何を成功とみなすか・失敗時どうなるか」を決めるシステム。

## 不変の原則
1. **契約が先**: 実行前に `done_when` を測定可能にする。無いと「少し簡単な別問題」を解いて完了を宣言される。
2. **証拠がゲート**: 「完了」はモデル出力にすぎない。完了を決めるのは終了コード・テスト・スキーマ・クエリ。判断が要る項目だけ LLM judge を最後段に。
3. **作る者と判定する者を分ける**: ビルダーは自分を採点しない。verifier は別コンテキスト・読み取り専用・「何があれば不合格か?」を問う。
4. **状態は会話の外**: `state.json` / `lessons.md` / git が system of record。圧縮・再起動・引き継ぎに耐える。
5. **ポリシーはモデルの外**: 検証器・契約の改ざん、破壊的操作、外部送信は hook で強制 (deny / ask)。
6. **盲目的に再試行しない**: 失敗を分類し、同一失敗の反復・上限到達で止めてエスカレーション。全ループに回数・時間・費用の上限。
7. **最小十分**: 失敗面が要求する分だけ複雑にする (L0→L3)。コンポーネントは「モデルにできないこと」の仮定であり、モデル更新で外せるか再検証する。
8. **失敗はハーネスに残す**: 出力を直すだけでなく map / check / cap / gate / state を直す (explanation → checklist → template → automated check → enforced policy)。

## 手順

### Phase 1 — 目的を契約にする
1. リポジトリと環境を把握する (CLAUDE.md、build/test コマンド、既存の `.harness/`、git 状態、使える CLI/コネクタ)。
2. 目的を `contract.yaml` の形に落とす: objective / intent / inputs / constraints / non_goals / deliverable / **done_when (claim・evidence・kind)** / approval_required / budget / rollback。
3. 推測で埋められない **ブロッカーだけ** を AskUserQuestion で 1 回にまとめて聞く (最大 3 問): 完了の定義が二通り以上に読める / 外部への副作用の可否 / 予算・期限。それ以外は妥当なデフォルトを置き、仮定として contract に明記する。

### Phase 2 — タスクをプロファイルする
| 軸 | 値 |
| :- | :- |
| 検証性 | deterministic / visual / judgment (混在なら各 done_when ごとに) |
| 時間軸 | 1 ターン / 1 セッション / コンテキスト窓を超える / 継続的 |
| 起動 | 今すぐ / 時間間隔 / 外部イベント / スケジュール |
| 並列性 | 単一 / 多数の独立アイテム / 解空間が広い(複数案比較) |
| リスク | read-only / 可逆 (workspace, branch) / 外部効果 (push, send, deploy) / 不可逆 |
| 実行場所 | 対話セッション / headless / クラウド(routine, 新規 clone) |

### Phase 3 — 形を選ぶ
`reference/patterns.md` の選択ガイドに従い、**ハーネスレベル (L0–L3)**、**ループ/グラフ形 (P1–P5, G1–G8)**、**起動方法** を 1 つずつ決める。既定の対応:
- 決定論的に証明できる + 1 セッション → **P1 Stop-gate ループ** (最も強い。`gate=stop`)
- 設定を軽くしたい / 既に対話中 → **/goal** (評価モデルは会話しか読まないので「verify.sh の出力が PASS」を条件にする。`gate=goal`)
- コンテキスト窓を超える / 夜通し → **P2 fresh-context headless ループ** (`run_loop.sh`)
- 外部状態を見張る → **P3 /loop** (自己ペース or 間隔) / Monitor
- スケジュール・イベント駆動・無人 → **P4 routine** (+ PR を人間ゲートに)
- 多数アイテム / 監査 / 移行 / 調査 → **G4 fan-out/refute/converge workflow**
- 解空間が広い → **G5 tournament**。 判断項目がある or 高リスク → **G1 verifier** を必ず足す
`--mode` 指定があればそれを優先し、合わない場合だけ理由を述べて代案を出す。プリミティブの正確な仕様・制限は `reference/primitives.md`。

### Phase 4 — ハーネスを鍛造する (実ファイル)
1. slug を決め (英小文字-ハイフン)、雛形を生成:
   `python3 ${CLAUDE_SKILL_DIR}/scripts/bin/harnessctl.py init <slug> --objective "<一文の目的>" --gate <stop|goal|none> --max-iterations <N>`
   → `.harness/bin/` (runtime)、`.harness/<slug>/` (contract.yaml, map.md, state.json, lessons.md, receipt.md, verify.sh, prompt.md, harness.json, launch.md)、`.claude/agents/<slug>-verifier.md`
2. **contract.yaml** を Phase 1 の内容で埋める (TODO を残さない)。
3. **verify.sh** に done_when を 1:1 でチェックとして書く (`check` / `tier` / `judge`)。安い決定論チェック → 高価な統合 → judge の順。コード以外の目的でも決定論的な骨格 (セクション・件数・引用・リンク・スキーマ) を先に。詳細: `reference/verification.md`。判断項目には `rubric.md` (合否の基準と例) を作る。
4. **map.md** に「どこに何があるか」と「読まないもの」を書く (段階的開示)。
5. **harness.json**: 正解を定義するテスト/fixture を `extra_protected_paths` に、タスク固有の危険操作を `extra_deny_commands` / `extra_ask_commands` に追加。上限 (`max_iterations`, `max_same_failure`) を契約の budget と一致させる。
6. **prompt.md** をタスク向けに具体化 (最初の一手、ドメイン固有の失敗分類)。**verifier** の攻撃観点をタスク向けに追記。
7. gate=stop のとき hooks を入れる: `python3 ${CLAUDE_SKILL_DIR}/scripts/bin/harnessctl.py install-hooks --block-cap <max_iterations+4>`
   (`.claude/settings.local.json` に Stop / PreToolUse / PostToolUse / SessionStart を冪等にマージ。ACTIVE が無い限り no-op)。**settings を書き換える前にユーザーに一言断る。**
8. workflow 形なら `templates/workflows/*.js` から始め、`args` と観点を調整 (編集前に `/workflow-authoring` を読む)。routine / headless なら `launch.md` の該当節を具体化。`launch.md` は選んだ起動方法 1 つだけ残す。

### Phase 5 — ハーネスを証明する (ここを飛ばさない)
1. `python3 .harness/bin/harnessctl.py check <slug>` が `"ok": true`。
2. **赤いベースライン**: `bash .harness/<slug>/verify.sh` が現状で **正しい理由で** FAIL する (既に PASS なら done_when が甘いか、既に完了)。
3. **感度**: 各チェックが「わざと壊した状態」で落ちることを頭の中か scratch コピーで確認。空振りチェック (常に PASS) を残さない。scratch コピー・参照解・壊した実装はリポジトリ外 (一時ディレクトリ) で作り、終わったら消す。**正解例をビルダーから見える場所に残すと答えの漏洩になる。**
4. **網羅**: すべての done_when id が verify.sh か verifier の項目にある。
5. **決定性と速度**: 同じ状態で 2 回同じ判定。毎イテレーション回せる速さ (遅いものは後段 tier か最終 verifier へ)。
6. runtime を疑うときは `bash ${CLAUDE_SKILL_DIR}/scripts/selftest.sh`。

### Phase 6 — 引き渡し / 起動
ユーザーに次を簡潔に示す:
- 設計サマリ表: 目的 · done_when と各証拠 · レベル/形/起動方法とその理由 · 上限と停止規則 · 人間の承認点 · 生成ファイル
- 起動コマンド (launch.md の 1 節)。止め方 (`! python3 .harness/bin/harnessctl.py deactivate <slug>`、Esc、`/goal clear`)。
- 事前に許可しておくべきツール (無人で回すなら auto mode か allow ルール)。
`--launch` 指定時、または明示的に頼まれたときだけ起動する: `harnessctl.py activate <slug> --gate <gate>` → `prompt.md` に従って作業開始 (gate=stop ならゲートが解放するまで止まれない)。外部効果のある起動 (routine 作成、push を伴う loop) は必ず確認を取る。

### Phase 7 — 走行後の改善 (次回以降を良くする)
実行後または失敗エスカレーション時: `receipt.md`・`lessons.md`・`trace.jsonl` を読み、`reference/recovery-and-learning.md` の対応表で **ハーネス側** を直す (map 追記 / check 追加 / cap 調整 / deny 追加 / state 項目追加)。同じ教訓が 2 回出たらラダーを 1 段下げて強制化。

## 品質チェックリスト (すべて Yes で引き渡す)
- [ ] 成功は実行前に定義されているか (done_when に evidence がある)
- [ ] 全部を読ませずに正しいコンテキストへ辿り着けるか (map.md)
- [ ] ツール・コマンドは目的・形式・失敗時の挙動が明確か
- [ ] 重要な決定は会話の外 (state.json) に残るか
- [ ] 完了に証拠が必要か (ゲートが exit code を見る)
- [ ] 危険な操作はポリシーで守られているか (guard: deny/ask、保護パス)
- [ ] すべてのループに上限があるか (回数・同一失敗・時間・費用・エージェント数)
- [ ] 中断後に再開できるか (SessionStart 再注入 / fresh-context / workflow resume)
- [ ] 重要な行動を再構成できるか (trace.jsonl)
- [ ] 失敗がルール・ツール・テスト・マップ・権限の改善につながるか (lessons.md)
- [ ] 最終変更をロールバックできるか (branch / PR / 下書き)

## アンチパターン
- 「もっと長いプロンプト」で直す / 全ドキュメントをコンテキストに詰める
- ビルダーが verify.sh・テストを書き換えられる (= 採点者の買収)
- /goal の条件に「ちゃんと動く」など会話から証明できない文言を書く
- 同じモデル 3 体の合議を「独立検証」と呼ぶ (決定論ノードが無いグラフ)
- 変化の遅い対象を 1 分間隔で polling する / 上限の無い loop-back
- 失敗した出力だけ直してハーネスを直さない

## 参照 (必要な時だけ読む)
- `reference/primitives.md` — /goal・Stop hook・/loop・workflow・routine・subagent・headless の検証済み仕様と制限
- `reference/patterns.md` — ハーネスレベル、ループ/グラフ形の一覧と選択ガイド
- `reference/verification.md` — done_when→チェック変換、非コード目的の決定論チェック、judge 設計、改ざん対策
- `reference/recovery-and-learning.md` — 失敗分類と対処、自己改善ループ、レシート
- `reference/examples.md` — バグ修正 / 大規模移行 / 調査レポート / PR 見張り / 指標改善 / 定期トリアージ / デザイン比較 / 夜間バックログ
- `templates/` — 生成物の雛形、`templates/workflows/` — fix-until-green / fanout-refute-converge / tournament
