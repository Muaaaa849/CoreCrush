# グラフィックとコンポジットの調査（M3 見た目・photoreal-arena）

2026-10-01。three 0.186.1（`three/webgpu` + TSL）前提。版は npm（`npm view`）と node_modules の実物で確認した。

## ライブラリ

| 名前 | 版（2026-10-01） | WebGPURenderer | 用途 / 所見 | 出典 |
|---|---|---|---|---|
| three-bvh-csg | 0.0.18（peer: three ≥0.179, three-mesh-bvh ≥0.9.7） | ○（出力は普通の BufferGeometry。描画系に依存しない） | Brush と Evaluator で A−B・A∪B・A∩B。BVH で交差する三角形だけ切るので速い。起動時に一度だけ組んで結合すればドローコールも増えない。結果に小さな隙間・細い三角形が出ることがある（フォーラム報告） | https://github.com/gkjohnson/three-bvh-csg , https://gkjohnson.github.io/three-bvh-csg/ , https://discourse.threejs.org/t/very-small-gaps-after-csg-operation-between-faces-of-the-meshes/77621 |
| three-mesh-bvh | 0.9.15 | ○（CPU 側） | CSG の土台。レイキャストの高速化 | https://github.com/gkjohnson/three-mesh-bvh |
| SkyscraperGenerator（three 公式 `examples/jsm/generators/city/`） | three 0.186 同梱 | ○（`MeshStandardNodeMaterial` + TSL。partId を頂点に焼いて 1 マテリアル 1 ドローコール。窓は interior mapping） | 「SkyscraperGenerator 系」の実体は three 本体に入っていた（npm に単独パッケージは無い。`skyscraper-generator` は 404）。基部・胴・頂部、面取り、セットバック、室外機まで手続き生成。1 棟 1 ジオメトリ。既定は 140m・レンガ調で、ネオン都市にするには色と窓の発光を差し替える | https://github.com/mrdoob/three.js/pull/34658 , https://github.com/mrdoob/three.js/tree/dev/examples/jsm/generators |
| その他の手続き都市 | — | 自作が要る | Rototu のシェーダー都市、threex.proceduralcity（mrdoob のデモ由来）など。手法の参考に留める | https://github.com/Rototu/procedural-skyscraper-city-generator-and-shader , https://github.com/jeromeetienne/threex.proceduralcity |
| three/addons の TSL ポスト | three 0.186 同梱 | ○（WebGPU / WebGL2 両方） | BloomNode・GTAONode・SSRNode・TRAANode・DepthOfFieldNode・ChromaticAberrationNode・FilmNode・Lut3DNode・LensflareNode・GodraysNode・SSGINode。**AnamorphicNode は 0.186 に無い**（削除済み）→ 横長の光芒は自作（横方向の縮小ぼかし）で代替 | https://threejs.org/docs/pages/TSL.html , https://threejs.org/docs/pages/LensflareNode.html , https://threejs.org/examples/?q=webgpu%20postprocessing |
| three-gpu-pathtracer | 0.0.26（peer: three ≥0.185, xatlas-web） | ×（WebGLRenderer 専用のパストレーサー） | 実時間の試合画面には使えない。静止画の見本（目標の絵）作りには使える | https://github.com/gkjohnson/three-gpu-pathtracer |
| postprocessing（pmndrs） | 6.39.5（peer: three <0.187） | ×（EffectComposer 系。WebGPU 非対応） | 規則（render.md）どおり不採用 | https://github.com/pmndrs/postprocessing |
| @react-three/* | — | — | React 前提。除外 | https://github.com/pmndrs/react-three-fiber |
| meshoptimizer | 1.3.0（導入済み） | ○ | glTF の頂点圧縮と簡略化（LOD）。既存のモデル変換で使用中 | https://github.com/zeux/meshoptimizer |
| Poly Haven / ambientCG | — | — | CC0 のテクスチャ・HDRI・モデル。既存の床・小物の取得元 | https://polyhaven.com/license , https://docs.ambientcg.com/license/ |

## コンポジット

出典: Stray Spark（フィルムルック）、HolyGrain（フィルムエミュレーション）、Pixel Tools（カラリストのフィルムエミュ解説）、GameAI（ゲームシネマティクスのグレーディング）、Creative Bloq・80.lv（キー/フィル/リム）、Radiator Blog（GDC 2018 How To Light A Level）、Game Developer（コントラスト・色光の設計）、Level Design Book（照明）。

- https://www.strayspark.studio/blog/blender-film-look-halation-grain-gate-weave
- https://www.holygrain.com/blog/what-is-film-emulation-in-digital-cinema/
- https://pixeltoolspost.com/blogs/resolve/film-emulation-explained
- https://www.gamineai.com/blog/color-grading-and-post-processing-for-game-cinematics-2026
- https://www.creativebloq.com/3d/how-to-use-key-fill-and-rim-lighting-in-3d-art
- https://80.lv/articles/lighting-in-3d-art-why-it-matters-how-to-improve-it
- https://www.blog.radiator.debacle.us/2018/03/gdc-2018-how-to-light-level-slides-and.html
- https://www.gamedeveloper.com/art/lighting-design-fundamentals-using-contrast-in-your-game
- https://www.gamedeveloper.com/design/lighting-design-fundamentals-how-and-where-to-use-colored-light
- https://book.leveldesignbook.com/process/lighting

### 学び（画作りの原則）
- **明暗の設計が先、色は後**。白黒にしても主役（コア・相手）が一番コントラストの高い場所にあること。暗部を真っ黒に潰さず、中間調に「形が読める」階調を残す（今の絵は黒が広く潰れている）。
- **キー / フィル / リム**: キー＝形を作る主光（方向が分かる硬めの光）、フィル＝暗部を持ち上げる弱い光（色を持たせると深みが出る。ここでは冷たい青）、リム＝輪郭を背景から切り離す。対戦相手は常にリムで縁取る。
- **色の分離**: 補色の対（シアン/マゼンタ、暖色の火/冷たい環境）を「場所」で分ける。全部を混ぜると濁る。暖色の点光源を少数置くと寒色の画面が締まる。
- **光は面で見せる**: 細い線だけの光源は「光っている物」には見えても「照らしている」ように見えない。床や壁に光だまり（ライトプール）を落とす。
- **ハレーション**: フィルムでは強いハイライトの周りが赤橙ににじむ。ブルームと別に、しきい値の高い所だけ暖色に薄く広げると「レンズとフィルムを通った絵」になる。
- **レンズの不完全さ**: 周辺減光（ビネット）、周辺の色収差（中心は 0、端だけ）、周辺のぼけ（edge blur）、光源からのゴースト（レンズフレア）。どれも**画面端ほど強く、中心は触らない**（照準とコアの可読性を守る）。
- **グレイン**: 暗部で目立ち、明部で消える（露光に反比例）。時間で変える。強すぎるとノイズに見えるので 2〜4% 程度。
- **LUT / カーブ**: シャドウを青緑へ、ハイライトを暖色へ（ティール＆オレンジの変形）。黒点を少し持ち上げ（リフト）、トーンカーブは S 字。彩度は中間調で上げ、ハイライトで下げる。
- **ライトリーク**: 画面の端から差し込む暖色の柔らかい光。ごく薄く、ゆっくり動かす（映画的な「生っぽさ」）。
- **空気中の塵**: 光の中でだけ見える細かい粒。奥行きと空気の厚みを与える。数は少なく、遅く。
- **フォーカスの設計**: 中心（照準）が一番シャープで、端ほどぼける。視線は明るさ・コントラスト・彩度の一番高い所へ行くので、それをコアに集める。

## 採否

| 項目 | 採否 | 理由 |
|---|---|---|
| three-bvh-csg | **採用** | 面取りした柱、パネルの溝・通気口・リベット穴、自キャラの仮モデルの切り欠きを起動時に一度だけ組む（`src/render/csgParts.ts`）。試合中は作らない |
| SkyscraperGenerator（three 公式） | **採用（遠景）** | 書き割りの代わりに実ジオメトリのビル群。棟ごとに 1 ドローコール、低画質では棟数を減らす。色はダークに、窓の発光はネオン寄りに |
| TSL ポスト: Bloom / SMAA | 既存 | — |
| ChromaticAberrationNode | 不採用（自作） | 画面全体を拡大縮小する方式で中心もずれる。端だけに掛けたいので、`postPipeline.ts` で半径に比例した RGB ずらしを自作 |
| FilmNode | 不採用（自作） | 明暗に応じたグレインにしたいので自作（暗部ほど強い） |
| Lut3DNode | 保留 | LUT 画像（.cube）を作る工程が要る。まずはカーブ（リフト・ガンマ・ゲイン・彩度・色温度）を TSL で書き、データで調整する |
| LensflareNode | **採用** | ブルームの出力からゴーストを作る。しきい値はデータ |
| GTAONode / SSRNode / TRAA / DOF | 保留 | MRT（法線・深度・速度）が要り、半透明（フェンス）と相性が悪い・重い。中低画質で外せる形で後から検討 |
| three-gpu-pathtracer | 不採用 | WebGPURenderer 非対応・実時間でない |
| pmndrs/postprocessing | 不採用 | WebGPU 非対応 |
| @react-three | 除外 | React を使わない |
