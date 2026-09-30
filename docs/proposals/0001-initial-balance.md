# 0001 balance.json 初版で実装側が置いた値（承認依頼）

`data/balance.json` の初版は GDD v1.0 と open-questions の回答から作った。
**GDD にも回答にも無く、実装側で置いた値**を以下に挙げる。承認、または差し替えの値をください。

| キー | 値 | 理由 |
|---|---|---|
| `throw.recoveryF` | 12 | 投擲後の硬直（Q-08 提案） |
| `parry.startupF` / `parry.recoveryF` | 1 / 10 | 跳ね返しの発生・成功後硬直（Q-08 提案） |
| `hit.reactionF` | 20 | 被弾リアクション（Q-08 提案） |
| `step.durationF` | 12 | 「5m を素早く」。出だしの速いイーズアウト |
| `catch.justBonusGain` | 0.25 | 通常球のジャストのご褒美（Q-25 提案） |
| `throw.types.curveLeft/Right.lateralM` | ±2.5 | 左右カーブの横膨らみ（側壁の手前で自動的に縮む） |
| `throw.types.curve*.apexM` | 0.5 | 左右カーブのわずかな山なり |
| `throw.types.lob.apexM` | 6 | 上カーブの頂点（回答: 最大6m） |
| `throw.types.curve*.speedMps` / `lob.speedMps` | 23 / 17 | GDD の値のまま（ストレートだけ 32 に変更済み） |
| `court.trajectoryMarginM` | 0.8 | 天井・側壁からの余白 |
| `court.fenceClearanceM` | 0.3 | 中央線からプレイヤーが近づける距離 |
| `player.bodyRadiusM` / `bodyHeightM` / `chestHeightM` / `handHeightM` | 0.4 / 1.8 / 1.3 / 1.6 | 箱キャラの寸法 |
| `player.pickupRadiusM` | 0.9 | 体（0.4）より広く（回答: 少し大きめ） |
| `ball.floorRestitution` / `maxBounceMps` / `wallRestitution` | 0.25 / 3.0 / 0.2 | 1〜2回しか跳ねない・壁でも跳ねない（回答）。高速球でも2回以内に収めるため跳ね返り速度に上限 |
| `round.interRoundSec` | 2 | ラウンド間の間 |
| `invariants.fakeReactionBudgetF` / `fakeNetBudgetF` | 13 / 3 | 「見てから」の反応と通信の余裕（Q-01） |
