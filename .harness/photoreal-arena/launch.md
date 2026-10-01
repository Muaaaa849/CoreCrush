# Launch — photoreal-arena

> harness-forge が選んだ起動方法を 1 つだけ残し、他の節は削除する。
> どの方法でも: 契約 = `contract.yaml`、完了判定 = `verify.sh` (+ `photoreal-arena-verifier`)、状態 = `state.json`。

## A. Stop-gate loop (interactive, deterministic gate)
```text
! python3 .harness/bin/harnessctl.py activate photoreal-arena --gate stop
Read .harness/photoreal-arena/prompt.md and follow it until the harness releases you.
```
- 推奨: auto mode (無人で回す) か、必要コマンドを allow ルールに入れておく。
- 途中で止める: `! python3 .harness/bin/harnessctl.py deactivate photoreal-arena`
- この作業は 1 回の検証が約 8 分（ビルド・撮影・盲検評価 $0.3）。ゲートが通るまで止まれないので、途中でプランナーの確認が要るときは deactivate する。
- 選んだ理由: 決定論チェック（D1〜D6, D8）と、ビルダーが改ざんできない盲検評価（verify.sh が自分で Sonnet 5.5 を起動）を Stop ゲートで束ねられる。対話中なのでプランナーが途中で口を出せる。
