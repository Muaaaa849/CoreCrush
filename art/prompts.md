# 画像の記録

生成はプランナーが Nano Banana 2（`gemini-3.1-flash-image`）で行う（CLAUDE.md「画像生成」）。
下書き `art/generated/`、参考資料 `art/reference/`、ゲームで使う採用分 `assets/`。

| ファイル | 用途 | モデル・設定 | プロンプト | 日付 |
|---|---|---|---|---|
| `art/reference/world-concept-01.jpg` | 世界観の参考（サイバーパンク×スチームパンクの街。1360×768） | Nano Banana 2（設定不明） | 不明（プランナー作成） | 2026-09-30 |
| `art/generated/backdrop-sky-01.jpg` | 遠景: いちばん奥の夜空（円筒に 3 回鏡映しで貼る）→ `backdrop_sky` | Nano Banana 2・2K 指定 | "Panoramic night sky over a polluted city, no buildings, no ground. Thick smog clouds lit from below by magenta, cyan and warm orange city glow, darker toward the top, a few dark silhouettes of flying airships far away. Painterly but realistic, no text." | 2026-09-30 |
| `art/generated/backdrop-cyber-01.jpg` | 遠景: サイバー街のシルエット（緑を切り抜き）→ `backdrop_cyber` | Nano Banana 2・2K・21:9 指定 | "Wide panoramic skyline strip of a dense cyberpunk megacity at night … solid pure green (#00FF00) chroma key, no sky, no text, no letters, no logos." | 2026-09-30 |
| `art/generated/backdrop-steam-01.jpg` | 遠景: スチームパンク工場群（緑を切り抜き）→ `backdrop_steam` | Nano Banana 2・2K 指定（出力は 16:9） | "Wide panoramic skyline strip of a steampunk industrial district at night … solid pure green (#00FF00) chroma key, no sky, no text, no letters, no logos." | 2026-09-30 |
| `art/reference/playtest-ball-glare-01.jpg` | プレイテストの画面（持った球が眩しい。修正済み） | — | — | 2026-09-30 |

## 外部の素材（ライセンス）
一覧と変換設定は `art/assets.json`（`npm run assets` で `assets/textures/*.ktx2` を作る）。

| 素材 | 出典 | ライセンス |
|---|---|---|
| asphalt_02（色・法線・粗さ 1K） | Poly Haven https://polyhaven.com/a/asphalt_02 | CC0 1.0 |
