---
paths:
  - "src/render/**"
  - "src/ui/**"
  - "bench/**"
---

# 描画規則（GDD 3.2, 12章）

## レンダラー
- `three/webgpu` の WebGPURenderer ＋ TSL ＋ RenderPipeline（旧 PostProcessing）。
  WebGPU 非対応環境では WebGL2 バックエンドへ自動フォールバックする。
- `three` と `three/webgpu` を同一ビルドで混在 import しない。
- EffectComposer と pmndrs/postprocessing は使わない（WebGPURenderer 非対応）。
  ポストは `three/addons/tsl/display/`（BloomNode, SMAANode, TRAANode, GTAONode 等）で組む。
- WebGLRenderer への切替は M0 のベンチ結果と ADR があるときだけ。

## sim との境界
- render は sim の状態を読むだけ。sim の状態を書き換えない。
- 描画は固定60Hz の sim 状態2つを補間する。ヒットストップ等の演出で sim の時間を止めない（Q-11 回答まで）。

## カメラ（不変条件）
- 非所持=TPS、所持=FPS。跳ね返しでは切り替えない。
- 切替は照準方向を回転させず、レティクルが指すワールド上の点を変えない。FOV を急変させない。
- TPS の照準は画面中央のレイで決め、肩越しの視差は照準点側で補正する。
- 揺れは最大0.15秒・小振幅。設定の強度（0〜100%）を必ず掛ける。

## 画づくり
- トーンマッピング ACES Filmic（または AgX）、露出 0.9 前後。
- ブルームは emissive ベースの選択的ブルーム。光らせるのはネオン・コア・フェンスだけ。
- **可読性最優先: コアを常に画面で最も明るい物体にする。** 背景の彩度を抑え、相手にリムライト。
- 影は主光源1灯のみ。

## 性能予算（ミドルノート PC・1080p・60fps 以上）
- ドローコール ≤ 150（小物は InstancedMesh / BatchedMesh）、画面内 ≤ 50万トライアングル。
- テクスチャは全て KTX2、VRAM ≤ 300MB。ポストプロセス ≤ 3ms。
- フレーム時間が 18ms を超えたら描画スケールを 0.85 まで自動で下げる。
- 予算に関わる変更は `npm run bench` の結果を添える。

## アセット
- glTF は meshopt 圧縮、テクスチャは KTX2（ベースカラー etc1s / 法線 uastc）、上限 2K。
- 単一ファイル ≤ 25MiB。ロードは選んだキャラとステージだけの段階ロード。
