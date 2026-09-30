# 0001 M0: レンダラー比較（WebGPU / WebGPURenderer の WebGL2 バックエンド / WebGLRenderer）

- 状態: **保留（実機計測待ち）**
- 日付: 2026-09-30
- 関連: GDD 12.1, 12.3, 19（M0） / open-questions Q-19, Q-20

## 背景
GDD は WebGPURenderer＋TSL＋RenderPipeline を推奨し、M0 で WebGL とのベンチ比較を必須としている。
負けた場合に WebGLRenderer へ切り替えると TSL 資産を作り直すことになる（Q-19）。

## 確認できたこと（Q-20）
- npm の `three` 最新は **0.186.1**（r186）。`three/webgpu`・`three/tsl` の exports あり。
- `RenderPipeline` クラスが存在し、`PostProcessing` は「r183 で RenderPipeline に改名」の deprecated 表記あり。
- `three/addons/tsl/display/` に BloomNode / SMAANode / TRAANode / GTAONode あり。
- `WebGPURenderer({ forceWebGL: true })` で WebGL2 バックエンドを強制できる。
- `vanilla-vfx`（0.6.0）と `three.quarks`（0.17.1）は npm に存在（中身の評価は M3）。

## 計測方法
- 基準シーン `src/m0/benchScene.ts`（1920×1080、影1灯、ネオン emissive、半透明フェンス、インスタンス2,000、約56万トライアングル）。
- 各フレーム「描画 → GPU 完了待ち」の壁時計時間の中央値・p95。WebGPU は `onSubmittedWorkDone`、WebGL は 1px `readPixels` で同期。
- ポスト: WebGPU 系は MRT で emissive を分離 → BloomNode → SMAANode。WebGLRenderer は EffectComposer＋UnrealBloomPass＋SMAAPass（pmndrs ではない近似）。

## クラウド環境（ヘッドレス Chromium 141・GPU なし・SwiftShader）での結果
| 構成 | 結果 |
|---|---|
| WebGPURenderer / WebGPU | **実行不可**（1回目: `createView` の `swizzle` 型エラー、2回目: Device Lost）。GPU なし環境のため判断材料にしない |
| WebGPURenderer / WebGL2 強制 | 中央値 1474ms（ソフトウェア描画） |
| WebGLRenderer | 中央値 1032ms（ソフトウェア描画） |
| DataChannel ループバック | state/event とも RTT 中央値 約1ms、ロス0（API・チャネル設定の妥当性のみ確認） |

ソフトウェア描画の数値は性能判断に使えない。**ミドルノート PC 実機での計測が必要。**

## 気づいた点
- 描画情報のドローコールは影パス・ポストの全画面パスを含む（本シーンで約190）。
  GDD 12.3 の「ドローコール150以下」が**シーン本体だけ**か**総数**かを決める必要がある（→ 実装側の提案: シーン本体 ≤150、総数は参考値）。
- `createView` の `swizzle` エラーは Chrome と three の組み合わせ次第で本番でも起きうる。
  実機で再現したら、初期化・初回描画の失敗時に `forceWebGL` で作り直すフォールバックを入れる。

## 決定（暫定）
- 実機結果が出るまで、GDD どおり **WebGPURenderer（TSL）を前提**に M1 を進める（M1 は箱キャラ中心で描画依存が小さい）。
- 切替が必要になった場合の第一候補は **WebGPURenderer の WebGL2 バックエンド強制**（TSL 資産を捨てない）。

## 撤回条件
- 実機で WebGPU バックエンドが WebGL2 系より明確に遅い（中央値で20%以上）→ WebGL2 バックエンドを既定に。
- WebGL2 バックエンドも WebGLRenderer より明確に遅く、予算（16.6ms）に収まらない → WebGLRenderer＋pmndrs を再検討（Q-19）。
