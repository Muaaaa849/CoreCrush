# Lessons — photoreal-arena

失敗は出力を直すだけでなく、ハーネスに「インフラ」を残す。1 行 1 教訓、形式:
`- [YYYY-MM-DD] <失敗クラス> <何が起きたか> -> <ハーネスへの恒久対策: map/tool/validator/cap/gate/state/trace> (<ラダー段階>)`

ラダー段階: explanation → checklist → template → automated-check → enforced-policy
同じ教訓が 2 回出たら 1 段下 (より強制的) に移す。

- [2026-10-01] perf SkyscraperGenerator の標準マテリアル（部屋のレイマーチ＋フラクタルノイズ）は撮影のソフトウェア WebGL で 1 フレーム数十秒→撮影タイムアウト -> 遠景・広い面積のシェーダーは「光の計算なし・ノイズなし」を既定にする。重いシェーダーを足したら ONE=1 の 1 視点撮影（.tmp-cap/cap.mjs）で時間を測ってから verify (checklist)
- [2026-10-01] tool 撮影 1 回 5〜6 分が律速 -> 1 視点だけ撮る試し撮り（capture.mjs を写して VIEWS を絞り、console を出す）を .tmp-cap/ に置いて使う (template)
- [2026-10-01] gate verify の前に validate:data を回さず 1 回無駄にした（スキーマ上限 opponentRim.hdr<1） -> data を触ったら必ず typecheck+validate:data を先に (checklist)
- [2026-10-01] effective 箱→CSG 人型・書き割り→SkyscraperGenerator・投光器とトラス・HUD 意匠で 36→55。readable は「足元の輪＋光の柱＋画面上で一定の大きさのしるし」で 0/3→3/3（球の大きさは変えていない） (explanation)
- [2026-10-01] noise 評価者のスコアは同じ絵でも ±3〜5 揺れる（55→50 は指摘の中身がほぼ同じ） -> 1 回の上下で方針を変えず、指摘の中身（カテゴリ）で判断する (checklist)
- [2026-10-01] bug python の文字列置換で既存行（group.add）を消して塔が消えた -> 置換後は 1 視点撮影の三角形数で確認（急減したら構造が抜けている） (checklist)
- [2026-10-01] rejected 「ボールを大きく」（評価者の直し方）は balance.json の範囲外なので採らない。発光・しるしで代替 (explanation)
- [2026-10-01] plateau 55〜58 が 5 回（カテゴリを モデル細部→光と大気→外周→小物→反射 と変えても）。指摘の 1 位は毎回「主役のモデルがプリミティブ」 -> 仮モデルの改良で上がる上限に達した。本番キャラ（M4）か、評価対象から外すかはプランナー判断。state.json の open_risks に書いて停止 (enforced-policy: 同じ失敗 3 回で止まる)
- [2026-10-01] flaky 撮影の球の位置が回ごとに違い（自陣／相手コート）、可読性の票が 0〜3/3 で揺れる -> 撮影モードの sim の初期状態を決定的にする提案（capture.mjs は保護。撮影モード側の初期化はコード側だが「撮影だけ別の絵」に当たらないかプランナーに確認） (explanation)
- [2026-10-01] effective コアの「画面上で一定の大きさの光の輪」と相手の頭上の三角が readable を最も動かした。光の輪を 40→30px に縮めたら readable 0/2 に戻った (explanation)
