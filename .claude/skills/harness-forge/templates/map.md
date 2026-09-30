# Context map — {{SLUG}}

コンテキストは倉庫ではなく「注意の予算」。全部を読ませず、どこに何があるかだけを示し、
タスクが必要とした時にだけ段階的に開示する (TASK → MAP → RELEVANT SYSTEM → EXACT FILES → LOCAL RULES)。

| 知りたいこと | 場所 | いつ読むか |
| :- | :- | :- |
| 目的・完了条件 | `.harness/{{SLUG}}/contract.yaml` | 毎イテレーション最初 |
| 現在地・次の一手 | `.harness/{{SLUG}}/state.json` | 毎イテレーション最初と最後 |
| 過去の失敗から得た教訓 | `.harness/{{SLUG}}/lessons.md` | 毎イテレーション最初 |
| TODO 例: アーキテクチャ | `docs/architecture.md` | 構造を変えるときだけ |
| TODO 例: コマンド (build/test/lint) | `package.json` scripts | 検証前 |

## 読まないもの
- TODO 例: `vendor/`, 生成物, 巨大ログ (必要なら grep で該当行だけ)

## 失敗したらここを直す
「必要な情報が見つからなかった」失敗は、このマップに 1 行足すことで次回以降すべての実行を改善する。
