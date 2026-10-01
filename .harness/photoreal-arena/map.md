# Context map — photoreal-arena

| 知りたいこと | 場所 | いつ読むか |
| :- | :- | :- |
| 目的・完了条件・プランナー確定事項 | `.harness/photoreal-arena/contract.yaml` | 毎イテレーション最初 |
| 現在地・次の一手・最新スコア | `.harness/photoreal-arena/state.json` | 毎イテレーション最初と最後 |
| 教訓（効いた手・効かなかった手・採らなかった指摘） | `.harness/photoreal-arena/lessons.md` | 毎イテレーション最初 |
| 直近の盲検評価の指摘（影響度順） | `.harness/photoreal-arena/judge/feedback.md`、各回は `judge/<時刻>/` | 毎イテレーション最初 |
| 撮影の視点（5 つ）と撮り方 | `.harness/photoreal-arena/capture.mjs`（読むだけ） | 視点を確かめたいとき |
| 描画の入口・シーン構成 | `src/render/protoView.ts`（球・キャラ・フェンス）、`src/render/stage.ts`（光・霧・金網・観客） | 構造を変えるとき |
| 床 / 遠景 / 小物 | `src/render/floor.ts` / `backdrop.ts` / `props.ts` | 該当箇所を直すとき |
| ポスト（ブルーム・SMAA・今後のコンポジット） | `src/render/postPipeline.ts` | ポストを足すとき |
| 看板シェーダー | `src/vfx/coreFace.ts`（コアの顔）、`src/vfx/plasmaFence.ts`（フェンス。確定済み・ノイズ禁止） | 該当箇所 |
| 見た目の数値とスキーマ | `data/render.json`＋`schemas/render.schema.json`、`data/quality.json`、`data/vfx/*.json`、検査 `scripts/validate-data.mjs` | 数値を足すとき（スキーマも足す） |
| アセットの取得・変換 | `art/assets.json`（テクスチャ）、`art/models.json`（Poly Haven モデル）→ `npm run assets`、出典 `art/prompts.md`、ADR 0006 | 素材を足すとき |
| 描画の規則・不変条件 | `.claude/rules/render.md`・`vfx.md`、`docs/gdd/GDD.md` 12・13 章、`docs/gdd/invariants.md` | 方針に迷ったとき |
| 世界観の参考 | `art/reference/world-concept-01.jpg`、`art/generated/`（プランナー生成の遠景） | 画作りの方向を決めるとき |
| 調査メモ | `docs/research/graphics-compositing.md`（D4 で作る）、`docs/asset-survey.md` | ライブラリ・手法を選ぶとき |
| コマンド | `npm run typecheck` / `validate:data` / `test` / `proto:gh-pages` / `assets` | 検証前 |

## 読まないもの
- `node_modules/`（API 確認で必要な行だけ grep）、`dist-pages/`・`dist-lab/`（生成物）、`art/source/`（取得元の素材）
- `src/sim/`・`src/net/`（見た目の作業では触らない）
- `judge/` の古い回（最新の feedback.md で足りる）

## 失敗したらここを直す
「必要な情報が見つからなかった」失敗は、このマップに 1 行足す。
