# CORE-CRUSH — Claude Code 作業ルール

## プロジェクト
- 1v1 FPS/TPS サイバー・ドッジボール。ブラウザ（Cloudflare Pages）＋ WebRTC P2P。
- 役割: ユーザー＝プランナー（仕様と数値の決定者）、Claude＝実装担当。
- 設計の正本: `docs/gdd/GDD.md`。**迷ったら該当章を読む。GDDと矛盾する実装はしない。**
- 体験の不変条件: `docs/gdd/invariants.md`。これを壊す変更は、数値調整でも不可。
- 未決事項: `docs/gdd/open-questions.md`。未回答の論点に触れる実装は、提案デフォルトで仮実装し
  コードに `// OPEN: Q-xx` を残す（勝手に確定させない）。
- **GDD 本文と open-questions.md の「回答」が食い違うときは回答を優先**（GDD v1.0 本文は書き換えない）。

## GDD 章インデックス（読む場所の目安）
| 触る領域 | 読む章 |
|---|---|
| ルール・カウント・勝敗 | 2, 8 |
| 操作・カメラ・溜め | 3, 14 |
| 球種・追尾・フリ | 4 |
| キャッチ・跳ね返し・ステップ | 5 |
| ステータス・コスト・ステップ回復 | 6 |
| スキル・キャラ | 7, 15 |
| 配信・アセット容量 | 10 |
| ネットコード | 11 |
| 描画・性能予算 | 12 |
| VFX | 13 |
| ハーネス運用 | 17 |
| マイルストーン | 19 |

## 最重要の不変条件（要約。全文は invariants.md）
- フリでキャッチを空振りさせたら、見てから投げたストレートが当たる（攻撃5・距離13m以内。硬直はステップで中断可）。
- 追尾球は通常移動で避けられない。回避方向の相性: ストレート=左右 / 左右カーブ=前後 / 上カーブ=左右（Q-29）。
- 8秒カウントは持っていても進み、8.0秒で自陣側が爆発。フェンス通過でリセット。
- ラリー加速は受けた球×1.06（上限なし）、キャッチ・爆発・被弾でリセット。返球の球種は移動キーで選ぶ。返した球の効果は返した側のもの。
- 追尾・吸着でキャッチや跳ね返しのタイミングを難しくしない。球は天井に当たらない。
- カメラ切替は照準方向とレティクルの指す点を変えない。回転・FOV急変なし。
- 遅延があっても受け手の反応時間を縮めない（飛翔時間を削らない）。

## スタック
- TypeScript（strict） / Vite / three（`three/webgpu`, `three/tsl`） / Vitest / Playwright
- シグナリング: Cloudflare Workers + Durable Objects。TURN: Cloudflare Realtime。
- 版数・API名（例: RenderPipeline）は導入時に npm と公式で確認し、差異は ADR に残す。

## ディレクトリ（予定。作成時にこの表を更新）
```
src/sim/        固定60Hzのゲームロジック。three・DOM・時刻API・Math.random 非依存
src/sim/judge/  キャッチ・跳ね返し・被弾・爆発・カウントの判定（受け手権威の判定点）
src/sim/effects/ スキル効果部品（buff_next_throw, projectile, pull ...）
src/net/        WebRTC DataChannel、シグナリングクライアント、権威移譲
src/render/     three/webgpu 描画、カメラ、補間
src/vfx/        TSL シェーダー、パーティクル（プール）
src/input/      キーバインド（KeyboardEvent.code）、Pointer Lock
src/ui/         HUD、設定画面
data/           balance.json, characters/, skills/, vfx/（数値の唯一の置き場）
workers/signaling/  Worker + Durable Objects
tests/          sim/, net/, e2e/    bench/  性能計測（run-m0.mjs, results/）
src/m0/         M0 技術検証ページ（使い捨て。本番コードから import しない）。lab/ は実機計測用 Artifact
src/proto/      M1 箱キャラ試作（Artifact で公開。`npm run proto:artifact`）  src/bot/  テスト・試作用ボット
docs/gdd/ docs/decisions/ docs/proposals/ docs/playtest/ docs/progress.md
```

## アーキテクチャ原則
- `src/sim` と `src/render` を分離。sim は固定60Hzの tick で進み、描画は補間で追従する。
- sim の時間単位はフレーム（tick）。秒で与えられた値はロード時に tick へ変換する。
- 数値は `data/*.json` のみ。コードにゲームバランスの数値を直書きしない（0/1・配列添字等は可）。
- キャラ・スキルはデータ駆動。新キャラ追加で sim を変更しない。
  新しい種類の効果部品を作るときだけ sim を変更可（ADR 必須）。
- ネットは受け手権威。ボールが自陣へ向かう間は受け手が判定し、返球で権威が移る。
  判定ロジックは `src/sim/judge/` に集約し、net 層に判定を書かない。
- 乱数は sim 内のシード付き RNG のみ。試合中の `new`（オブジェクト生成）はプールで避ける。

## コマンド（予定。package.json 作成時に実体と一致させる）
- 実在: `npm run dev` / `build` / `typecheck` / `test` / `test:sim` / `test:mutation`（感度チェック） / `validate:data`
  / `m0:headless` / `m0:lab` / `proto:artifact`
- 予定: `npm run test:net` / `npm run bench` / `npm run lint`
- クラウドで Playwright を使うときは `CHROMIUM_PATH=/opt/pw-browsers/chromium`（`playwright install` はしない）

## 作業の流れ
1. 関連する GDD 章・invariants.md・ADR・open-questions.md を読む。
2. 小さく変更する。1コミット1論点。
3. `test:sim`（sim を触ったら必須）→ `typecheck` → 必要なら `bench`。
4. 不変条件に関わる変更は、対応する不変条件テストが緑であることを確認する。
5. 設計判断（GDD の推奨より良い手法を採った場合を含む）は `docs/decisions/NNNN-<slug>.md` に書く。
   形式: 背景 / 決定 / 代替案 / 不変条件への影響 / 撤回条件。
6. セッション終了時に `docs/progress.md` へ「やったこと / 次 / 未解決」を追記し、冒頭の「現在の状態」「作業中」を書き換える。
   **コンテキスト圧縮・新セッションの後は、まず `docs/progress.md` の冒頭を読んで再開する。**

## 数値変更のルール
- `data/balance.json` はプランナー承認なしに変更しない。
  変更案は `docs/proposals/NNNN-<slug>.md` に「現値 / 案 / 理由 / 不変条件への影響」で出す。
- キャラ・スキルの JSON 追加は可。ただしステータス合計 ≤ 16、妨害系スキル ≤ 1。
- テストのために数値を変えたくなったら、テスト側でフィクスチャを差し替える。

## 禁止
- main への直接 push。作業ブランチで行う。
- 不変条件テストの削除・skip・期待値の緩和（プランナー承認なし）。
- 試合中のアロケーション（パーティクル・ボール・イベントはプール）。
- 25MiB 超の単一アセット。TURN 資格情報などの秘密をクライアントやリポジトリに置くこと。
- sim から three / DOM / `performance.now` / `Date` / `Math.random` を参照すること。

## 難しい問題・ループが必要なとき
- 機械で合否を判定できる反復作業（不変条件テスト化、性能予算、遅延注入など）は、
  `/loop` や自分で使えるコマンドで回してよい。
- 常設ハーネスは `/harness-forge <目的> --mode ...`（`.claude/skills/harness-forge/`、Muaaaa849/hernes から導入）。
  生成物は `.harness/<slug>/`。verify.sh と contract.yaml の変更（完了条件の変更）はプランナーの承認が必要。
- 行き詰まったら、試したこと・仮説・次の一手を `docs/progress.md` に書いてから相談する。

## 手触りの扱い
- 「気持ちいいか」は機械判定しない。数値の保証と退行防止はテスト、手触りはプランナーのプレイテスト。
- 手触りに関わる変更を入れたら、何をどう確かめてほしいかを `docs/progress.md` に書く。

## ドキュメントの言語
- docs・コミットメッセージ・コメントは日本語で可。識別子・JSON キーは英語（camelCase）。
- JSON の時間キーは単位を接尾辞で明示: `...F`（フレーム, 整数）/ `...Sec`（秒）/ `...Mps`（m/s）。

## 詳細ルール（該当パスを触るときだけ読み込まれる）
- `.claude/rules/netcode.md` — src/net, src/sim/judge, workers, tests/net
- `.claude/rules/render.md` — src/render, src/ui, bench
- `.claude/rules/vfx.md` — src/vfx, data/vfx
- `.claude/rules/data.md` — data, スキーマ, src/sim/effects
