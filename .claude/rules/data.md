---
paths:
  - "data/**"
  - "src/data/**"
  - "src/sim/effects/**"
  - "schemas/**"
---

# データ規則（GDD 0, 6, 7, 15章）

## 置き場所
- `data/balance.json`: 補正式の係数・球種・防御・カウント・コスト・ステップの定数。
- `data/characters/<id>.json`, `data/skills/<id>.json`, `data/vfx/<id>.json`。
- 全 JSON はスキーマで検証する（`npm run validate:data`）。スキーマ無しのファイルを追加しない。

## 変更権限
- **`data/balance.json` はプランナー承認なしに変更しない。** 案は `docs/proposals/` に出す。
- 新キャラ・新スキルの JSON 追加は可。ただし以下を満たすこと:
  1. スキーマ検証が通る
  2. ステータス合計 ≤ 16（基準 15）、各値 1〜10
  3. 妨害系スキルは1キャラ1つまで（スキルに `category` を持たせて機械判定する）
  4. 全スキルに VFX / SFX / アイコンの ID
  5. ボット10ラウンドのスモークテストでエラーなし
  6. `docs/playtest/<id>.md` を作る（中身はプランナーが書く）

## 書式
- キーは英語 camelCase。時間は単位接尾辞で明示: `...F`（フレーム・整数）、`...Sec`、`...Mps`、`...M`。
- 割合は倍率（1.06）か加算率（0.06）かをキー名で区別: `...Mul` / `...Add`。
- ステータス依存の値は、表ではなく式の係数で持つ（GDD 6.1 の式）。表は検証用テストに使う。

## スキルの組み立て
- スキルは効果部品（`buff_next_throw`, `place_zone`, `place_ring`, `projectile`, `stun`, `pull`,
  `teleport`, `illusion`, `ball_transfer`, `area_block`）とトリガー（`throw`, `catch`, `parry`, `hit`,
  `step`, `count_tick`, `ball_cross_fence`）の組み合わせで表す。
- 直接攻撃系スキル（projectile 等）は追尾しない。スキーマで `homing: true` を禁止する。
- 新しい効果部品を足すときだけ `src/sim/effects/` を変更してよい（ADR 必須）。
