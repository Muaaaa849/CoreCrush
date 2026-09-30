# 進捗

> **コンテキスト圧縮・新セッションの後は、まずこの「現在の状態」と「作業中」を読む。**
> ここは常に最新に書き換える。下の「ログ」は追記のみ。

## 現在の状態（2026-09-30 更新）

### マイルストーン
| M | 状態 |
|---|---|
| M0 技術検証 | 完了。WebGPURenderer 採用（暫定、ADR 0001）。ミドルノート PC での再計測は M3 で |
| M1 ローカルの芯 | 進行中。sim・不変条件テスト・箱キャラ試作まで完了。プレイテスト1回目のフィードバックを反映中（下の「作業中」） |
| M2〜M5 | 未着手 |

### 公開物（claude.ai Artifact。プランナーはローカルにファイルを持たない）
- 箱キャラ試作: https://claude.ai/artifact/HZRBvv3kNFYov2Bbpdv8KN（`npm run proto:artifact` → `dist-lab/core-crush-proto.html` を同じパスで再公開すると URL 維持）
- M0 計測ラボ: https://claude.ai/artifact/HjjEjbyddmbB7RVXvD5PDc（結果は db コレクション `m0Results`、ArtifactData で読める）

### コードの現状
- `src/sim/`: 固定60Hz。誘導曲線の飛翔（ADR 0002）、投擲・フリ・キャッチ（ジャスト）・跳ね返し・ステップ・8秒カウント・爆発・自動取得・ラウンド。
- `src/bot/simpleBot.ts`、`src/input/keyboardMouse.ts`、`src/render/{cameraRig,protoView}.ts`、`src/proto/`（試作）。
- テスト 106 件緑（`npm test`）。感度チェック `npm run test:mutation` は 14 変異すべて赤。`npm run validate:data` OK。
- hooks: main への push 拒否、既存 `data/balance.json` の変更は ask（`.claude/hooks/guard.mjs`）。
- harness-forge スキル導入済み（`.claude/skills/harness-forge/`）。
- ブランチ: `claude/zealous-fermat-dnuy3b`（リモートのデフォルトブランチもこれ）。

### 決定済みの要点（詳細は open-questions.md の「回答」）
- フリ→ストレートは「見てから」。攻撃5・距離13m以内で保証。空振り硬直48F（受付終了から）、ステップ・スキルで中断可。
- キャッチ猶予・ジャスト幅は防御で変化（中央値でジャスト2F）。防御9〜10＋iron_grip で跳ね返しと並ぶのは許容（Q-28 回答）。
- ラリーは受けた球×1.06（乗算・上限なし）。天井8m・上カーブ頂点最大6m。ステップ5m、方向はコート固定。
- ドローコール予算はシーン本体で150。提案 0001（実装側で置いた数値）は承認済み。D-9 はステップ回復の式を正とする。

## 作業中: プレイテスト1回目のフィードバック反映（未着手・未コミット）
プランナーの指示（2026-09-30）と実装方針:
1. **球速を全体に少し速く** → 案: straight/aimed 32→35、curveLeft/Right 23→25、lob 17→19（m/s）。
   `data/balance.json` の変更（hook で ask が出る。承認済みの方向性）。提案記録 `docs/proposals/0002-playtest1-tuning.md` を作る。
2. **キャッチ・跳ね返しを早押ししないといけない感覚をなくす**。原因（回答済み）: 発生フレーム（キャッチ2F・跳ね返し1F）＋描画の補間遅れ最大1F＋入力の読み取り最大1F。
   判定は「球の中心が胸に届いた瞬間」でキャラより前ではない。
   → `catch.startupF` 2→0、`parry.startupF` 1→0。描画は球を前後 tick の補間ではなく外挿（cur + (cur−prev)·alpha）にして遅れを消す。
   INV-01 の余裕が発生短縮で2F減るが、球速35で約2F増えるので相殺見込み。テストで要確認。
3. **跳ね返しでも移動キーで球種を打ち分け**（W/無入力=ストレート、A/D=左右カーブ、S=上カーブ）。速さは受けた球×1.06 のまま。
   球種判定（world.ts の throwTypeFromInput）を共通モジュールに出し、judge/arrival.ts の跳ね返しで使う（狙い投げは除く）。
   FlightKind の 'parry' を廃止し、返球も球種名にする（ラリー回数は ball.rally）。invariants INV-12・テスト・ボット（返球方向をランダムに）を更新。
4. **拾える範囲を広く** → `player.pickupRadiusM` 0.9→1.3。
5. **ストレートは左右ステップで回避、前後は被弾**（Q-29 の回答）→ straight の `evade` を `["left","right"]` に。
   INV-03 の期待表・CLAUDE.md の不変条件要約（「ストレート=全方向」）・invariants.md・open-questions（Q-29 回答）を更新。
6. Q-28 回答: validate-data の iron_grip 警告を「許容（防御キャラの特権）」に変更。INV-06 に追記。
7. 提案 0001 を承認済みに、D-9 を確定に更新。
8. 反映後: `npm test`・`npm run test:mutation`・`npm run validate:data`・typecheck → 試作を再ビルドして同じ URL に再公開 → progress 更新 → コミット・push。

## ログ

## 2026-09-30 セッション1（コード未着手）
- やったこと: GDD v1.0 を `docs/gdd/GDD.md` に配置。CLAUDE.md、`.claude/rules/`（netcode/render/vfx/data）、
  `docs/gdd/invariants.md`、`docs/gdd/open-questions.md` を作成。
- 次: open-questions の優先度 A への回答を受けて M0（技術検証）/ M1（ローカルの芯）の計画を立てる。
- 未解決: open-questions.md の Q-01〜Q-24、D-1〜D-8。

## 2026-09-30 セッション1（続き）
- やったこと: プランナー回答（Q-01〜07, 10, 13, 15, 22）を open-questions.md に反映。
  invariants.md の INV-01/02/03/11/12/13 を更新し、INV-21〜23 を追加。CLAUDE.md・netcode 規則を更新。
- 次: Q-01 の数値案（ストレート32m/s・空振り硬直48F）の承認、Q-25〜27 の回答 → M0 着手（最初に Q-22 の permissions/hooks）。
- 未解決: Q-08, 09, 11, 12, 14, 16〜21, 23〜27, D-1〜8（提案で仮実装予定）。

## 2026-09-30 セッション1（M0 着手）
- やったこと:
  - Q-25/26/27 の回答を反映（ジャスト幅はキャッチ受付と同じステータスで変化・中央値2F、ラリー上限撤廃、天井8m）。
  - Q-22: `.claude/settings.json` ＋ `.claude/hooks/guard.mjs` で main への push を拒否、既存 `data/balance.json` の変更は承認（ask）必須に。
  - Vite＋TypeScript の骨組み、three@0.186.1 を固定。M0 検証ページ（レンダラー3種のベンチ、Pointer Lock、DataChannel）。
  - ADR 0001: ヘッドレスでは WebGPU 計測不可。実機計測待ち。
- 次: プランナー実機での M0 計測 → ADR 0001 確定。並行して M1（sim 骨組み・data スキーマ・不変条件テスト）。
- 未解決: キャッチ猶予の参照ステータス（防御 or 敏捷）、Q-01 の数値承認、ドローコール予算の数え方。
- プランナーに確かめてほしいこと: 実機で `m0/` の各ページを開き、表示された JSON を共有（手順は bench/README.md）。

## 2026-09-30 セッション1（実機計測の準備）
- やったこと: キャッチ猶予＝防御で確定、Q-01 数値を暫定承認で確定、ドローコール予算＝シーン本体で確定。
  ベンチを関数化し、シーン本体のドローコールを計測。計測ラボを Artifact として公開（結果は db に自動保存）。
- 次: プランナーの実機計測結果を読み、ADR 0001 を確定。並行して M1。
- プランナーに確かめてほしいこと: 計測ラボ（https://claude.ai/artifact/HjjEjbyddmbB7RVXvD5PDc）を普段の PC の Chrome で開き、2・3 を実行。

## 2026-09-30 セッション1（M0 実機結果）
- やったこと: 計測ラボの結果（RTX 5060 Ti デスクトップ）を読み、ADR 0001 を「WebGPURenderer 採用（暫定）」で更新。
- 次: M1（sim 骨組み・data スキーマ・不変条件テスト）。
- 未解決: ミドルノート PC での計測（M3 で実ステージとともに）。

## 2026-09-30 セッション1（M1: sim と不変条件テスト）
- やったこと:
  - harness-forge を `.claude/skills/harness-forge/` に導入（selftest 36/36）。
  - `data/balance.json`・スキーマ・`npm run validate:data`。
  - sim（`src/sim/`）: 固定60Hz、誘導曲線の飛翔モデル（ADR 0002）、投擲・フリ・キャッチ（ジャスト）・跳ね返し（×1.06）・ステップ・硬直・8秒カウント・爆発・自動取得・ラウンド。
  - テスト 106 件（不変条件 INV-01〜12, 17, 18, 20〜22、ボット戦スモーク、決定論、sim の純粋性）。
  - 感度チェック `npm run test:mutation`: 値を壊した14通りすべてでテストが赤になることを確認。
- 見つかったこと: Q-28（防御9〜10＋iron_grip）、Q-29（前後ステップとストレート）、D-9（ステップ回復の表と式）、高速球の床バウンド（跳ね返り速度に上限を追加）。
- 次: 箱キャラの遊べる試作（描画・カメラ・入力）を Artifact で公開し、プランナーがボットと対戦できるようにする。
- 未解決: proposals/0001（実装側で置いた数値）の承認、Q-28, Q-29。

## 2026-09-30 セッション1（M1: 箱キャラ試作）
- やったこと: 入力（KeyboardEvent.code・Pointer Lock 生入力）、TPS/FPS カメラ、three/webgpu の箱描画、HUD、ボット対戦の試作を作り Artifact で公開。
  - 試作: https://claude.ai/artifact/HZRBvv3kNFYov2Bbpdv8KN
  - 初回描画で WebGPU が失敗する環境（Chrome 141）は WebGL2 に自動で切り替わることを確認。
- プランナーに確かめてほしいこと（手触り）:
  1. フリ→ストレート: 前に出た相手（ボット「的」にすると確認しやすい）に Q → ボットが空振り → 見てから左クリックで当たるか。
     空振りを見てから投げて「間に合う」と感じるか、「余裕がありすぎる／なさすぎる」か。
  2. 回避方向: A/D カーブを左右ステップで避けられない、S の上カーブを前後ステップで避けられない、が「読み合い」として分かるか。
  3. ラリー: ボット「つよい」で跳ね返し合い、速くなっていく緊張感と「いずれ返せなくなる」感じ。
  4. カメラ: 拾う・キャッチで FPS、投げ終わりで TPS に戻る切替が酔わないか、照準がずれて感じないか。
  5. 8秒カウント: 数字と色（SMILE→NERVOUS→ANGRY→点滅）で「欲張りライン」が読めるか。
  - F3 でフレーム表示（自分・ボットの行動と経過フレーム）が出る。
- 既知の制限: 見た目は仮、スキル・球召喚・狙い投げの照準補正は未実装。ボットは単純。
