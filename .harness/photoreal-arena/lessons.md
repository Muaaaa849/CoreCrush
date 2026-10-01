# Lessons — photoreal-arena

失敗は出力を直すだけでなく、ハーネスに「インフラ」を残す。1 行 1 教訓、形式:
`- [YYYY-MM-DD] <失敗クラス> <何が起きたか> -> <ハーネスへの恒久対策: map/tool/validator/cap/gate/state/trace> (<ラダー段階>)`

ラダー段階: explanation → checklist → template → automated-check → enforced-policy
同じ教訓が 2 回出たら 1 段下 (より強制的) に移す。

- [2026-10-01] perf SkyscraperGenerator の標準マテリアル（部屋のレイマーチ＋フラクタルノイズ）は撮影のソフトウェア WebGL で 1 フレーム数十秒→撮影タイムアウト -> 遠景・広い面積のシェーダーは「光の計算なし・ノイズなし」を既定にする。重いシェーダーを足したら ONE=1 の 1 視点撮影（.tmp-cap/cap.mjs）で時間を測ってから verify (checklist)
- [2026-10-01] tool 撮影 1 回 5〜6 分が律速 -> 1 視点だけ撮る試し撮り（capture.mjs を写して VIEWS を絞り、console を出す）を .tmp-cap/ に置いて使う (template)
