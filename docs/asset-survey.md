# CC0 3D モデル・素材の調査（2026-09-30）

目的: コート外周（違法賭博闘技場・ジャンク街）の小物。ライセンスは CC0 に限る（出典表記の手間とリスクをなくす）。

| サイト | ライセンス | 取得 | 画風 | 判断 |
|---|---|---|---|---|
| **Poly Haven** (polyhaven.com/models) | CC0 | API と CDN で直接取れる（このクラウド環境から可） | 実写 PBR。床（同じく Poly Haven）と生成画像の遠景に合う | **採用**。industrial 分類から 10 点 |
| Quaternius (quaternius.com) | CC0 | Google Drive のフォルダ。クラウドからは遅くて途中で止まる | ローポリの可愛い系。Cyberpunk Game Kit・Posed Background Characters | 保留。画風が合わない。観客のシルエットには使えるかも（プランナーが zip を添付してくれれば取り込める） |
| Kenney (kenney.nl) | CC0 | zip 直リンク | ローポリ・単色 | 見送り（画風） |
| ambientCG | CC0 | API | テクスチャ専門（モデルなし） | 床の候補（今回は Poly Haven asphalt_02） |
| Sketchfab | 作品ごと（CC0 もある） | ダウンロードに API キーが要る | 様々 | 見送り（キー管理が要る） |
| poly.pizza / Fab | CC0 / 様々 | このクラウドから 403 | — | 見送り |
| OpenGameArt | 作品ごとに混在 | 可 | 様々 | 見送り（ライセンス確認の手間） |

## 採用した 10 点（Poly Haven、`art/models.json`）
security_light（投光器・支柱の上）、security_camera_01（監視カメラ）、power_box_01（フェンスの電源箱）、barrel_stove（燃えるドラム缶・橙の点光源）、
Barrel_01 / barrel_03（ドラム缶）、old_tyre（タイヤ）、propane_tank（ガスボンベ）、modular_industrial_pipes_01（配管）、exterior_aircon_unit（室外機の山）。
合計 約 6.2MB（512px テクスチャ）、全部が画面に入っても 約 24 描画・約 24 万三角形（間引き済み）。

## 次の候補（必要になったら）
- modular_airduct_circular_01 / rectangular_01（ダクト）、steel_frame_shelves、metal_trash_can、street_lamp_01、overhead_crane（天井クレーン。9 万三角形と重い）。
- キャラクター（M4）: CC0 のリグ付き人型は Quaternius の Universal Base Characters など。画風を決めてから。
