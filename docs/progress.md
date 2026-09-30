# 進捗ログ

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
