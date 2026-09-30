# 0001 M0: レンダラー比較（WebGPU / WebGPURenderer の WebGL2 バックエンド / WebGLRenderer）

- 状態: **採用（暫定）** — ミドルノート PC での再計測が残る
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

## 実機計測の方法
プランナーの手元にはリポジトリのファイルがないため、計測ページを **claude.ai の Artifact（計測ラボ）** として公開した。
- URL: https://claude.ai/artifact/HjjEjbyddmbB7RVXvD5PDc
- 中身: `src/m0/lab/`（`npm run m0:lab` で `dist-lab/m0-lab.html` を生成し、1ファイルとして公開）
- 結果は Artifact の db（コレクション `m0Results`）に自動保存され、実装担当が読み出す。保存できない表示では JSON をコピーしてチャットに貼る。
- 制約: Artifact 内では WebRTC が使えないため、DataChannel の実機計測は M2（シグナリング実装後）に回す。

## 気づいた点
- 描画情報のドローコールは影パス・ポストの全画面パスを含む（本シーンで約190）。
  **決定（プランナー 2026-09-30）: 予算「150以下」はシーン本体のドローコール**（視錐台内の描画オブジェクト数）。総数は参考値として記録する。
- `createView` の `swizzle` エラーは Chrome と three の組み合わせ次第で本番でも起きうる。
  実機で再現したら、初期化・初回描画の失敗時に `forceWebGL` で作り直すフォールバックを入れる。

## 実機結果（2026-09-30・プランナー環境）
端末: GALLERIA（デスクトップ）/ GeForce RTX 5060 Ti（WebGPU: nvidia / blackwell）/ Claude デスクトップアプリ（Electron 44・Chrome 152）

| 構成 | 中央値 | p95 | 最大 | 本体DC | 総DC |
|---|---|---|---|---|---|
| WebGPURenderer / WebGPU | 3.9ms | 6.5ms | 67.1ms | 83 | 193 |
| WebGPURenderer / WebGL2 強制 | 0.4ms | 2.8ms | 3.2ms | 83 | 191 |
| WebGLRenderer | 1.6ms | 2.0ms | 2.4ms | 83 | 191 |

マウス: `unadjustedMovement` 対応（生入力 OK）、`pointerrawupdate` あり。

### 読み方
- 3方式とも予算（16.6ms）の数分の1。**この端末ではどれを選んでも性能は問題にならない。**
- WebGPU が数字上は遅いが、同期方法が違う（WebGPU は `onSubmittedWorkDone` の往復、WebGL 系は 1px `readPixels`）ため**方式間の比較には使えない**。
  WebGL2 強制の 0.4ms は同期が効いていない可能性が高い。正確な比較には GPU タイムスタンプ（`trackTimestamp`）での計測が要る。
- WebGPU の最大 67ms は初回のシェーダー／パイプライン生成と見られる。試合開始前にウォームアップ描画を入れる。
- Chrome 152 系では WebGPU が正常に動いた。クラウドの Chrome 141 で出た `swizzle` エラーはブラウザの版の問題と見られる。
- この端末は GDD の基準（ミドルノート PC）より明らかに強い。**予算の最終判断はノート PC の結果が必要。**

## 実機結果（2026-09-30・スマホ）
端末: Xiaomi 11T（21081111RG、Android 12、Mali-G77 MC9 / WebGPU: arm / valhall）/ Claude Android アプリの WebView（Chrome 153）。
基準シーンは PC と同じ 1920×1080 固定（スマホの画面より画素が多い）。

| 構成 | 中央値 | p95 | 最大 | 本体DC | 総DC |
|---|---|---|---|---|---|
| WebGPURenderer / WebGPU | 31.4ms | 43.7ms | 56.1ms | 83 | 191 |
| WebGPURenderer / WebGL2 強制 | 55.1ms | 77.7ms | 109.3ms | 83 | 191 |
| WebGLRenderer | 45.0ms | 56.3ms | 65.5ms | 83 | 191 |

- スマホでは **WebGPU が最も速い**（WebGL2 強制より 43%、WebGLRenderer より 30% 短い）。WebGPURenderer 採用の判断を補強する。
- ただし M3 目標相当の重さを 1080p で描くと約 32fps。スマホで 60fps には画質段階（描画解像度・ブルーム・影・三角形数）が必要（Q-31）。
- 計測は各フレームで GPU 完了を待つため、実際のゲームループ（待たずに重ねる）よりやや悲観的な値。

## 決定（暫定）
- **WebGPURenderer（TSL）を採用**。GDD の推奨どおり。
- 初期化・初回描画で失敗したら `forceWebGL` で作り直すフォールバックを入れる（古い Chrome 対策）。
  **実装済み（試作 `src/render/protoView.ts`）**: Chrome 141 では `init()` は通り、初回の `render()` で `swizzle` 例外が出ることを確認。
  そのため初期化直後に試し描画（ウォームアップを兼ねる）を行い、失敗したら WebGL2 で作り直す。
- 試合開始前にシェーダーのウォームアップ描画を行う（初回の数十 ms の引っかかり対策）。
- ベンチは M3 で GPU タイムスタンプ計測に切り替え、実ステージでノート PC を含めて再計測する。
- 切替が必要になった場合の第一候補は **WebGPURenderer の WebGL2 バックエンド強制**（TSL 資産を捨てない）。

## 撤回条件
- 実機で WebGPU バックエンドが WebGL2 系より明確に遅い（中央値で20%以上）→ WebGL2 バックエンドを既定に。
- WebGL2 バックエンドも WebGLRenderer より明確に遅く、予算（16.6ms）に収まらない → WebGLRenderer＋pmndrs を再検討（Q-19）。
