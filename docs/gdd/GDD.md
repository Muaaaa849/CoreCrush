# CORE-CRUSH ゲームデザインドキュメント（GDD）v1.0 — 1v1 FPS/TPS サイバー・ドッジボール

本作は「Cloudflare Pages（静的配信）＋ WebRTC DataChannel（P2P）＋ Three.js WebGPURenderer」で、ブラウザ版でも品質を落とさずに作れる。ただし、指定の画像生成プラグインは「Google AI Studio の無料API」では画像を生成できない。2026年9月時点の Gemini API 公式料金表で、画像生成モデル3種の無料枠がすべて「Not available」だからだ。 [google](https://ai.google.dev/gemini-api/docs/pricing) 事前に課金を有効にするか、運用を切り替える必要がある。

## TL;DR

- **ゲーム設計**：体験の芯は「8秒で爆発するコアを、跳ね返しのラリーとフェイントで押し付け合う読み合い」。球種ごとに回避方向を分け（ストレートは全方向、左右カーブは前後、上カーブは左右）、「キャッチ空振りの硬直 ＞ 溜め＋ストレート着弾時間」を不変条件として数値を固定する。これで「フリ→ストレート」が確実に刺さる手応えになる。数値は全て JSON に外出しする。
- **技術構成**：配信は Cloudflare Pages（Cloudflare Docs によれば1ファイル25MiB・無料プラン20,000ファイル、静的配信は無制限）を推奨する。GitHub Pages は GitHub Docs によれば公開サイト1GBまで・帯域は月100GBのソフト上限で、3Dアセットを積むとすぐ窮屈になる。通信は WebRTC DataChannel（非信頼チャネル＋信頼チャネルの2本）に、ボールが向かう側のクライアントが判定権を持つ「受け手権威」方式を組み合わせる。TURN は Cloudflare Realtime（公式料金ページによれば SFU と合算で毎月1,000GBまで無料）を使う。
- **AI開発運用**：hernes（harness-forge）は「目的→検証可能な完了条件→自律ループ」を生成するスキルなので、決定論テスト・キャラ追加・性能予算など機械で判定できる工程にだけ使う。手触りは人間のプレイテストで判断する。画像生成プラグインは Gemini の画像モデルが無料枠外のため、課金を有効にして低価格モデルを使う（Google公式料金ページで、3.1 Flash Lite Imageは1K画像1枚あたり0.0336ドル、3.1 Flash Imageは0.067ドル）か、AI Studio のブラウザ画面で手動生成して取り込むかを選ぶ。

---

## 0. 本書の位置づけと採用ルール

- 本書はプランナー視点の設計書です。「どう感じさせたいか」とその理由、変えてはいけない不変条件、調整できるパラメータを定めます。実装手段は推奨案です。
- **全章共通：本書の推奨手法（ライブラリ、通信方式、ホスティング、数値、ツールの使い方）より良い手法が見つかった場合は、そちらを採用して構いません。** 条件は①本書の「体験上の不変条件」を守ること、②採用理由を `docs/decisions/` に残すこと。
- 数値はすべて初期値です。コードに直書きせず `data/` 配下の JSON で管理し、プレイテストで調整します。

---

## 1. コンセプトと世界観

違法電脳都市のジャンク街で、廃棄予定の暴走エナジーコアを投げ合う。自陣で8秒経てば顔面ごと破裂する。サイボーグ同士の1v1ケージファイト「CORE-CRUSH」。

| 世界観要素 | ゲームシステム上の役割 | 演出の方向性 |
|---|---|---|
| 電磁フェンスの違法賭博闘技場 | コート外周の透明な壁。観客・賭け表示は背景 | 金網越しのネオン、ホログラム賭け率、雨と蒸気 |
| 中央のプラズマ・フェンス | ボールだけ通過可。通過でカウントリセット。人は弾かれる | 通過時の閃光と波紋。人が触れると火花とノックバック |
| コアの液晶の顔 | 残り時間UIをボール自体に持たせる | 0〜3秒スマイル、3〜5秒焦り顔、5秒以降は真っ赤な激怒顔、8秒で破裂 |
| サイボーグ／人体改造者 | 改造部位＝スキルの由来 | スキル発動時に改造部位が発光 |

**体験の芯**：「残り秒数の緊張」「速い球を返し続けるリズム」「リズムを崩す一手（上カーブ・フリ・狙い投げ）」の三つ巴。スキルは味付けで、HPを削る主役は通常球の応酬です。

---

## 2. 基本ルール

### 2.1 コートと試合形式（提案値）

| 項目 | 初期値 | 意図 |
|---|---|---|
| 片側コート | 幅10m × 奥行12m | 前に出るか下がるかに意味が出る広さ |
| 標準距離 | 約14m | ストレートの着弾が約0.5秒 |
| 相手コートへの侵入 | 不可（フェンス＋透明な壁） | 1v1 の間合いを固定 |
| 勝利条件（補足） | HP 0 でラウンド取得、2ラウンド先取 | 原案に未記載 |
| ラウンド開始 | ボールはランダムな側のコート中央に出現、3秒後にカウント開始 | 開幕の理不尽を避ける |

### 2.2 8秒カウント
- 投げられたボールが中央線を越えて自陣に入った瞬間に0から開始し、フェンスを通るたびにリセットします。
- 手に持っていてもカウントは進みます。**持ち続けるのは安全ではない**ことが緊張の源です。
- 8.0秒で爆発し、自陣のプレイヤーが爆発ダメージ30（固定）を受けます。**新しいボールは相手コートに出現**します。

### 2.3 カウントと球威（「ギリギリまで持つ」リスクとリターン）
投げた時点のカウント t 秒で、球速倍率 = 1 + 0.25×(t/8)²、威力倍率 = 1 + 0.60×(t/8)²。終盤ほど急に伸びます。

| カウント | 0秒 | 2秒 | 4秒 | 6秒 | 7秒 | 7.5秒 |
|---|---|---|---|---|---|---|
| 球速倍率 | 1.00 | 1.02 | 1.06 | 1.14 | 1.19 | 1.22 |
| 威力倍率 | 1.00 | 1.04 | 1.15 | 1.34 | 1.46 | 1.53 |
| 顔 | スマイル | スマイル | 焦り | 激怒 | 激怒（点滅） | 激怒（亀裂） |

6秒を超えると明確に強くなりますが、7秒を過ぎて投げ損ねれば自爆です。この「欲張りライン」を顔の変化で読ませます。

---

## 3. 操作とカメラ

### 3.1 デフォルトのキーバインド（全て変更可能。14章）

| 状態 | 入力 | 行動 |
|---|---|---|
| 共通 | WASD／マウス | 移動／視点（レティクル常時表示） |
| 共通 | 左Shift | ステップ（移動入力の方向。無入力なら後方） |
| 共通 | E / R | スキル1 / 2（攻撃系はボールの有無に関係なく使える） |
| 共通 | F（提案） | コモンスキル「球召喚」（原案でキー未定のため） |
| 所持時 | 左クリック（ニュートラル／W） | ストレート |
| 所持時 | A／D＋左クリック | 左／右カーブ |
| 所持時 | S＋左クリック | 上カーブ |
| 所持時 | 右クリック押下中→左クリック | ADS（少しズーム）→狙い投げ |
| 所持時 | Q | 投げるフリ（コスト0.25） |
| 非所持時 | 左クリック／右クリック | 跳ね返し／キャッチ |

### 3.2 カメラ設計（「ラリー中にカメラを大きく動かさない」の具体化）

| 場面 | カメラ | 切り替え |
|---|---|---|
| 非所持 | TPS（右肩越し、頭上0.35m・後方2.2m） | — |
| 所持 | FPS | — |
| キャッチ成功 | 全フレーム終了後に FPS へ | 150msで前方へドリー。**レティクルの位置と照準方向は不変** |
| 跳ね返し | TPS のまま | 切り替えなし |
| 投擲後 | FPS→TPS | 投擲モーション終わりから120msで後方へ |
| 被弾・爆発 | TPS | 揺れは最大0.15秒・小振幅。設定で0〜100% |

**不変条件**：切り替えは「照準軸に沿った前後移動」だけ。回転やFOVの急変はしません。TPSの照準は画面中央のレイで決め、肩越しの視差は照準点側で補正するので、切り替え前後でレティクルの指す場所がずれません。

### 3.3 投擲の溜め
左クリック直後に溜め8F（約133ms）が入り、その間の歩行速度は−70%。球種は溜めの最終フレームの方向入力で決まります（先行入力可）。

---

## 4. 攻撃行動（球種）

### 4.1 球種の基本値（攻撃5・カウント0）

| 球種 | 初速（m/s） | 軌道 | 追尾 | 標準距離の着弾 | 有効な回避ステップ |
|---|---|---|---|---|---|
| ストレート | 28 | 直線 | あり | 約0.50秒（30F） | 全方向 |
| 左右カーブ | 23 | 水平な弧 | あり（**左右回避では切れない**） | 約0.75秒 | **前後のみ** |
| 上カーブ | 17 | 上に弧を描き斜めに落ちる | あり | 約1.0秒 | **左右のみ**（提案） |
| 狙い投げ | 28 | レティクル方向へ直線 | **なし** | 着弾点次第 | 通常移動でも回避可 |

**意図**：原案で決まっている回避方向は左右カーブ（前後）だけです。上カーブは「落下角で前後回避に追いつく」ものとして左右回避のみ有効にし、球種と回避方向をじゃんけんの関係にします。

### 4.2 追尾
- 狙い投げ以外は追尾し、**通常移動では絶対に避けられません**。対処はキャッチ、跳ね返し、ステップ、スキル、被弾のみ。
- 実装方針：ボールは毎フレーム相手の胸へ角速度上限つきで旋回します。有効方向へのステップ開始フレームで「追尾解除」し、以後は直進します。

### 4.3 投げるフリ（Q）
- コスト0.25で、本物と同じ溜めと振りかぶりを再生します（投げない）。あらゆる行動でキャンセル可。途中で左クリックすると本物を投げますが、**モーションは最初から再生され、必要フレームは通常と同じ**です。
- **最重要の不変条件**：「フリで相手にキャッチを空振りさせたら、最速のストレートが高確率で当たる」。これを次の不等式で保証します。

  **キャッチ空振り硬直（40F） ＞ 溜め（8F）＋ストレート着弾（約30F） − 反応の余裕（数F）**

  空振りした側の逃げ道はステップ（ポイント消費）かスキルだけになり、「フリはステップを吐かせる道具」になります。

### 4.4 狙い投げ
追尾なし、ストレートと同じ速さでレティクル方向へ。用途は①回避先を読んで置く、②相手コートの隅に投げて自分のステップ回復時間を稼ぐ（6.3）。

---

## 5. 防御行動

| 行動 | 入力 | 受付 | 成功時 | コスト | 失敗時 |
|---|---|---|---|---|---|
| キャッチ | 右クリック | 防御で変化（下表）。**最短** | 保持。全フレーム後に FPS | +1.0 | 硬直40F |
| 跳ね返し | 左クリック | 9F固定 | 即返球（カメラ不変） | +0.25 | 硬直24F |
| ステップ | 左Shift | — | 有効方向なら追尾解除（無敵ではない） | 0 | ポイント1消費 |

**キャッチ受付（防御参照）**：防御1＝4F、2〜3＝5F、4〜6＝6F、7〜8＝7F、9〜10＝8F。全体は発生2F＋受付＋完了22Fで、完了後に FPS へ切り替えます。

**跳ね返しのラリー加速**
- 跳ね返すたびに球速+6%（跳ね返しの跳ね返しも同じ）、上限+40%（約6往復）。キャッチ・爆発・被弾でリセット。
- スキルによる効果ごと返せます。**「相手の強化球で自爆させる」快感**を守るため、返した球の効果は返した側のものになります。
- 返球は常に「ストレート相当の追尾球」で、引き継ぐのは速さだけ（読み合いを単純にするため）。

---

## 6. ステータス設計

### 6.1 補正表（5＝補正なし）

| 値 | 1 | 2 | 3 | 4 | **5** | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 攻撃：球速倍率 | 0.84 | 0.88 | 0.92 | 0.96 | **1.00** | 1.04 | 1.08 | 1.12 | 1.16 | 1.20 |
| 防御：最大HP | 68 | 76 | 84 | 92 | **100** | 108 | 116 | 124 | 132 | 140 |
| 敏捷：移動倍率 | 0.84 | 0.88 | 0.92 | 0.96 | **1.00** | 1.04 | 1.08 | 1.12 | 1.16 | 1.20 |
| 敏捷：ステップ回復（秒） | 19.7 | 18.5 | 17.4 | 16.3 | **15.0** | 14.2 | 13.4 | 12.7 | 12.1 | 11.5 |

- 式：球速＝基本値×(1+0.04×(攻撃−5))、HP＝100+8×(防御−5)、ステップ回復秒＝15÷(1+0.06×(敏捷−5))。基本移動速度5.0m/s。
- ステータス合計は**全キャラ15を基準、上限16**。尖らせるときはどれかを下げます。
- **攻撃は球速にだけ効きます**（着弾時間が縮むこと自体が攻撃力）。通常球の基本ダメージは20×威力倍率×スキル倍率で、HP100なら5発で倒れます。

### 6.2 コスト（最大5）
キャッチ+1.0、跳ね返し+0.25、回避0。使い道はフリ0.25、球召喚1.0、各スキル。**リスクを取ってキャッチするほどスキルが使え**、跳ね返しは安全で速い代わりに溜まりが遅い、という設計です。

### 6.3 ステップポイント（最大2）
敏捷5で15秒に1回。**回復はボールが相手コートにある間だけ進みます**。狙い投げで隅に投げて時間を稼ぐか、最速の跳ね返しで相手の回復を止めるか、という選択が生まれます。UIは「相手コートにボールがあるときだけ光って進む」ゲージにします。

---

## 7. スキル設計

- 構成：キャラ固有2つ（アクティブ／パッシブ、2つともアクティブや2つともパッシブも可）＋コモン1つ。
- **コモン「球召喚」**：コスト1。自陣の投げられていないボールを即座に手元へ。
- **直接攻撃系スキルは追尾しません**（攻撃スキルでステップを消費させる行動が強すぎるため。原案どおり）。

| ID | 名称（仮） | 種別 | コスト | 効果 | 持続・CT | 設計上の注意 |
|---|---|---|---|---|---|---|
| overcharge | オーバーチャージ | A | 1.5 | 次の1球の球速+15%、威力+30% | 次の投擲まで | 跳ね返されると相手のもの（自爆リスク） |
| trap_mine | 設置トラップ | A | 2 | 相手コートに設置、踏むと0.6秒スタン | 最大1個・12秒 | 設置位置は薄く見える |
| boost_ring | ブーストリング | A | 2 | 相手コートにリングを置く。以後の投擲でリングも狙える。入ったボールは0.15秒止まり、そこから相手へ射出（追尾あり） | 最大2・15秒 | 射出角が変わり回避の読みがリセットされる |
| phantom | ファントムスロー | A | 2.5 | 相手には右・左・上カーブとストレートの4球に見える。本物は1つ、幻影は0.3秒で消える | 次の投擲1回 | 幻影に判定なし。返球には付かない |
| backline_lock | バックライン封鎖 | A | 3 | 相手コートの後ろ半分を侵入不能に | 6秒 | チェーンと同じキャラに持たせない |
| chain_pull | チェーンハンド | A | 2 | チェーン（追尾なし）で相手をコート前面へ引き寄せる | CT10秒 | 引き寄せ中もキャッチ・跳ね返し可 |
| energy_bolt | エナジーボルト | A | 2 | 狙い投げ式のエネルギー弾（追尾なし）。所持中の相手に当たればボールを落とし自分のものに、非所持ならスタン0.5秒 | CT8秒 | 転送されたボールのカウントは0から |
| blink | ブリンク | A | 1.5 | 向いている方向へ4m瞬間移動（ボール所持中も可） | CT9秒 | 追尾は切れる。ステップポイント非消費 |
| iron_grip | アイアングリップ | P | — | キャッチ受付+1F | 常時 | 防御キャラ用 |
| afterburn | アフターバーン | P | — | ラリー加速+8%（通常+6%） | 常時 | ラリー特化用 |

**サンプルキャラ**：ヴォルト・ハウンド（攻7/防4/敏5、HP92、overcharge＋phantom、速球で押し切る）／ブルワーク（4/7/4、HP116、chain_pull＋iron_grip、キャッチで溜めて前に引きずり出す）／グリッチ（5/4/7、HP92、blink＋boost_ring、角度とステップ回復で翻弄）。

---

## 8. 体験上の矛盾・曖昧点と決定

| # | 論点 | 本書の決定 |
|---|---|---|
| 1 | 被弾後のボール | 被弾者の足元に落ち、カウントは継続 |
| 2 | 勝利条件 | HP0でラウンド取得、2ラウンド先取 |
| 3 | 上カーブの回避方向 | 左右のみ有効（じゃんけん化） |
| 4 | ラリー加速が無限だと反応不能 | +40%で上限、キャッチ等でリセット |
| 5 | 爆発後の新球が相手側に出るのは二重罰 | 意図的な強い罰として採用。ただし出現から1.5秒は相手のカウントを止める |
| 6 | コスト0だとフリ不可 | 仕様とする。「キャッチで稼いだ者だけがフェイントできる」資源 |
| 7 | 返球の球種 | ストレート相当、速さのみ引き継ぐ |
| 8 | 封鎖＋チェーンの重ねがけ | 「妨害系は1キャラ1つまで」をルール化 |
| 9 | 持ったままカウント満了 | 持っていても爆発 |
| 10 | TPSでの跳ね返しの照準 | 自動追尾で照準不要。レティクルを使うのは狙い投げだけ |

---

## 9. 参考作品からの学び

| 作品 | 取り入れる | 取り入れない |
|---|---|---|
| Knockout City（Velan Studios／EA、チーム戦ドッジボール） | フリでキャッチのタイミングを外す。キャッチのモーション終わりに投げて当てる定石。カーブ（横）とロブ（上）でリズムを崩す。ロックオンで、精度より位置取りと読みが勝敗を分ける | パス、プレイヤーをボールにする要素、マップギミック | [Push Square +2](https://www.pushsquare.com/guides/knockout-city-tips-and-tricks-for-beginners)
| BAKUDO（SAYIL GAMES／集英社ゲームズ、1v1のSFボスラッシュ・ドッジボール） | 1v1の真っ向勝負の緊張、アニメ的な派手さ、漫画のコマ風ヒット表現 | ボスラッシュ（PvE）構造 | [FinalBoss.io](https://finalboss.io/bakudos-sci-fi-boss-rush-anime-sports-style) [KAKUCHOPUREI](https://www.kakuchopurei.com/2025/06/bakudo-is-a-high-octane-ball-sports-boss-rush-action-title-from-shueisha/)
| Slappyball（手でプレーするバレーボール） | 叩き返すラリーのテンポ、返し続けるほど高まる緊張 | レビューで「floaty」とされた物理任せの操作感。本作は入力への即応を最優先 | [Metacritic](https://www.metacritic.com/game/slappyball/) [GamersHeroes](https://www.gamersheroes.com/honest-game-reviews/slappyball-review/)

**差別化**：「自陣8秒で爆発」による攻守の強制交代と、「ステップ回復はボールが相手コートにある時だけ進む」ことによる時間の資源化は、参考作品にない独自の読み合いの軸です。

---

## 10. ホスティングと配信

| 項目 | GitHub Pages | Cloudflare Pages（無料） |
|---|---|---|
| 容量 | 公開サイト1GBまで | 総量の明示なし、1ファイル25MiBまで | [VPS Ranking](https://vpsranking.com/serverless/cloudflare-pages/) [github](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
| ファイル数 | — | 20,000（有料は100,000、`PAGES_WRANGLER_MAJOR_VERSION=4` が必要） | [Cloudflare](https://developers.cloudflare.com/pages/platform/limits/index.md) [Cloudflare](https://developers.cloudflare.com/changelog/post/2026-01-23-pages-file-limit-increase/)
| 帯域 | 月100GBのソフト上限 | 静的アセットは無料・無制限 | [VPS Ranking](https://vpsranking.com/serverless/cloudflare-pages/) [github](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
| ビルド | 1時間10ビルドのソフト上限、デプロイ10分でタイムアウト | 無料枠の上限あり | [DEV Community](https://dev.to/david_viejo_4d48fdfa7cfff/cloudflare-pages-free-tier-limits-pricing-2026-1f8f) [github](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
| サーバー処理 | なし | Functions／Workers（無料は1日10万リクエスト、CPU 10ms） | [DEV Community](https://dev.to/david_viejo_4d48fdfa7cfff/cloudflare-pages-free-tier-limits-pricing-2026-1f8f)

**容量見積り（圧縮後の初期ロード、キャラ4体＋ステージ1）**：キャラglb（約2万トライアングル、Meshopt＋KTX2 2K×3枚）3〜6MB×4＝12〜24MB、ステージ10〜20MB、VFXと顔のアトラス約3MB、サウンド（Opus）8〜15MB、デコーダー（Meshopt・Basis）2〜3MB。**合計は約35〜65MB**。

- GitHub Pages は初回約50MBだと、およそ2,000人の新規プレイヤーで月100GBに達します。**話題になった時点で詰まるおそれがあり、本番には不向き**です。
- **推奨：Cloudflare Pages を本番に。** 25MiB超のファイルは分割するか Cloudflare R2 へ。GitHub はソース管理と自動デプロイに専念させます。
- 圧縮：glTF-Transform で `meshopt`（ジオメトリ・アニメ）、`etc1s`（ベースカラー）／`uastc`（法線）の KTX2 化、`resize` で上限2K。 [glTF Transform](https://gltf-transform.dev/modules/functions/functions/meshopt)  [glTF Transform](https://gltf-transform.dev/) ロードは選んだキャラとステージだけの段階ロード。
- **別媒体**：この構成で品質は守れます。将来の選択肢は①Tauri デスクトップ版（同じ Web コードを包む。オフライン大会・低スペック対策）、②itch.io の HTML5 版（露出用。容量制限は未確認のため採用前に確認）。より良い配信手段があれば採用可。

---

## 11. WebRTC 1v1 通信対戦

### 11.1 接続構成

| 役割 | 推奨 | 代替 |
|---|---|---|
| シグナリング | Cloudflare Workers＋Durable Objects（部屋コード1つ＝1オブジェクト、WebSocket で SDP/ICE を中継） | 試作は PeerJS の無料クラウド PeerServer（本番には非推奨、同時接続上限の報告あり） [Gonzalo Hirsch](https://gonzalohirsch.com/blog/virtually-free-peer-js-server-on-gcp/) [oreilly](https://www.oreilly.com/library/view/javascript-moving-to/9781787125919/ch26s03.html) |
| STUN | `stun.cloudflare.com`（Cloudflare TURN FAQ で無料・無制限と明記） | Google 公開 STUN [Peerjs](https://peerjs.com/client/api/peer) |
| TURN | Cloudflare Realtime TURN（SFUと合算で月1,000GB無料、超過1GBあたり0.05ドル。UDP 3478／TCP 80／TLS 443） | 自前の coturn |
| 認証情報 | Worker が短命の TURN 資格情報を発行（トークンはサーバー側だけ） | — | [GitHub](https://github.com/Didson-ONew/entrepreneurs-/pull/31)

通信量は60Hz×約100バイト×双方向≒12KB/秒で、5分の試合が約3.6MB。全試合が TURN 経由でも無料枠で約27万試合まかなえます。Durable Objects の無料枠の具体値は未確認のため、採用前に公式で確認してください。

### 11.2 DataChannel
- `state`（非信頼、`ordered:false, maxRetransmits:0`）：60Hz の入力と位置。 [GitHub](https://github.com/preyneyv/webrtc-pong)  [GitHub](https://github.com/webrtc-rs/webrtc/issues/915) ロス対策に直近4フレームを冗長同梱。
- `event`（信頼、既定設定）：投擲、キャッチ、跳ね返し、スキル、被弾、爆発、ラウンド遷移（フレーム番号つき）。 [github](https://github.com/wawesomeNOGUI/webrtcGameTemplate/blob/main/README.md)

### 11.3 ネットコード：「受け手権威」を推奨
**考え方**：飛んでいるボールの追尾先は常に受け手で、受け手の位置を一番正確に知っているのは受け手自身です。**ボールが自陣へ向かっている間は、受け手が軌道とキャッチ・跳ね返し・被弾を判定します**。

1. 投げた側は投擲イベント（開始フレーム、球種、速度倍率、カウント、スキル効果）を信頼チャネルで送る。
2. 受け手はそこから決定論的にボールを生成して追尾させる。片道30〜60msの遅れは、**飛翔時間を伸ばさずに発射点から再生**して吸収するので、受け手の反応時間は縮まない。投げた側には往復遅延ぶん遅れて結果が届くが、待つだけなので体感への影響は小さい。
3. 判定結果は受け手がイベントとして確定し、返球した時点で権威が相手に移る。
4. 相手の移動は100ms補間で表示し、自分は即時反映（予測）。

**理由**：判定のほとんどは「受け手の入力タイミングとボールの到達」の比較で、フレーム精度が要るのは受け手側だけです。ロールバックは全体を決定論にする必要があり、ブラウザ間の浮動小数点の差や Three.js との分離のコストが大きくなります。
**代替**：完全対称の公平性が必要なら、固定60Hzの決定論シミュレーション＋入力遅延2F＋ロールバック（GGPO方式）を採用して構いません（固定小数点化と描画の完全分離が必須）。 [Johan Helsing Studio +2](https://johanhelsing.studio/posts/extreme-bevy)
**不正対策**：カジュアルな P2P を前提に受け手の申告を信頼し、ランクマッチ導入時に Durable Objects 上のサーバー権威を検討します。
**必須テスト**：RTT 0／80／160ms×ロス 0／2／5% の遅延注入で「フリ→ストレート」の成立率とキャッチの体感を確認。同じ入力列の再生で両クライアントのイベントログが一致するか確認。

---

## 12. Three.js の品質を底上げする

### 12.1 レンダラー
- **推奨：`three/webgpu` の WebGPURenderer＋TSL＋RenderPipeline。** 最新は r186（npm の three@0.186.0、2026年9月8日公開）で、WebGPU 非対応環境では WebGL2 に自動で切り替わります。r183 で `PostProcessing` は `RenderPipeline` に改名されました。
- pmndrs/postprocessing と EffectComposer は WebGPURenderer では動かないため、`three/addons/tsl/display/` の BloomNode、SMAANode、TRAANode、GTAONode などで組みます。WebGPU のほうが遅いシーンの報告もあるので、**M0 で WebGL とのベンチ比較を必ず取り**、負けたら WebGLRenderer＋pmndrs/postprocessing に切り替えて構いません。 [Utsubo](https://www.utsubo.com/blog/webgpu-threejs-migration-guide) [Utsubo](https://www.utsubo.com/blog/threejs-2026-what-changed)

### 12.2 画づくりの標準

| 要素 | 標準 |
|---|---|
| トーンマッピング | ACES Filmic（またはAgX）、露出0.9前後でネオンの白飛びを抑える |
| ブルーム | emissive ベースの選択的ブルーム。しきい値高めでネオン・コア・フェンスだけ光らせる |
| AA | SMAA。高画質設定は TRAA |
| 環境 | HDRI 環境マップ＋PBR。濡れた路面は粗さムラでネオンを映す |
| ライティング | マゼンタとシアンの補色エリアライト。影は主光源1灯だけ |
| 空気感 | 高さフォグ、雨、蒸気。遠景はビルボード |
| 可読性（最優先） | コアを常に最も明るい物体に。背景の彩度を抑え、相手にリムライト |

### 12.3 最適化予算（ミドルノートPC、1080p で60fps以上）
ドローコール150以下（小物は InstancedMesh／BatchedMesh）、画面内50万トライアングル以下、テクスチャは全て KTX2 で VRAM 300MB以下、ポストプロセス3ms以下、ロジックは固定60Hzで描画は補間、フレーム時間が18msを超えたら描画スケールを0.85まで自動で下げる。

---

## 13. 3Dエフェクト（VFX）

- **看板エフェクト（フェンス、コアの顔、軌跡、爆発のコア）は TSL の自作シェーダー**で作り、独自性と軽さを両立させます。
- 汎用パーティクル（火花、破片、煙）はライブラリで。WebGPU 前提なら WebGPU ネイティブの Three-VFX（`vanilla-vfx`）か TSL コンピュート。WebGL なら three.quarks（BatchedRenderer でドローコール最小化、エディタから JSON 書き出し）。three.quarks の WebGPU 対応（quarks.nodes）は実験段階です。 [GitHub +2](https://github.com/Alchemist0823/three.quarks)

| エフェクト | 実装 | 変化 |
|---|---|---|
| プラズマ・フェンス | 平面＋TSL（スクロールノイズ、フレネル、ヒット波紋を最大4つ uniform で渡す） | ボール通過で閃光と波紋、人が触れると火花 |
| コアの液晶の顔 | 球の一部の UV 領域に表情アトラスを LCD シェーダー（画素グリッド、走査線、色収差）で表示 | スマイル→焦り→激怒（赤く発光）→7秒からノイズ・点滅・亀裂→8秒で破裂 |
| 軌跡 | 頂点バッファを再利用するリボン | 球種で色、球速で長さ、跳ね返しごとに色温度が上がる |
| 爆発 | 閃光（TSL）＋破片＋衝撃波リング＋短いシェイク | ヒットストップ |
| キャッチ・跳ね返し | 衝撃波リング、火花、2〜4Fのヒットストップ | 成功の気持ちよさ最優先 |
| スキル | 改造部位の発光＋キャラ固有色 | ファントムの幻影は本物と同じ見た目で0.3秒で崩れる |

**ルール**：パーティクルは全てプールで使い回す（試合中に new しない）。1エフェクトの上限を決める（例：爆発2,000粒子・1.2秒）。プリセットは `data/vfx/*.json` に置き、スキルからは ID で参照。

---

## 14. PC設定仕様（キーバインド・マウス感度）

### 14.1 キーバインド
- `KeyboardEvent.code`（物理位置）で保存するので、JIS や AZERTY でも WASD の位置がずれません。表示はレイアウトに合わせたキー名。
- 3.1の全行動をマウス5ボタン・ホイールを含めて割り当て可能。重複時は上書きか入れ替えかを確認。Esc は予約。
- `localStorage` に JSON で保存し、文字列で書き出し・読み込み可能。球種の方向キーは移動キーの割り当てに連動。

### 14.2 マウス感度
- Pointer Lock API の `requestPointerLock({ unadjustedMovement: true })` で OS のマウス加速を切った生入力を取り、非対応なら通常ロックに切り替えます。 [GitHub +2](https://github.com/TurboWarp/extensions/issues/2135) Firefox も 152 で対応しました。 [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock) [Mozilla Bugzilla](https://bugzilla.mozilla.org/show_bug.cgi?id=2037802)
- **生入力は ON/OFF 切り替え可能**にします（macOS で重く感じるという報告があるため）。 [GitHub](https://github.com/selkies-project/selkies/issues/328)
- 回転角（度）＝movementX×感度×0.022（他のFPSと数値を合わせやすい係数）。cm/360°も併記。
- 項目：全体感度、TPS／FPS／ADS 倍率（ADS は FOV 比から自動計算）、縦横比、Y反転、FOV（TPS・FPS別）、レティクルの形・色・サイズ、シェイク強度。

---

## 15. 新規キャラ追加に強い設計（プランナー視点）

**原則「キャラ追加＝データ追加だけ」**：`data/characters/<id>.json`、アセット、必要なら `data/skills/<id>.json` を置くだけで動くようにします。コード変更が要るのは「新しい種類の効果」を初めて作るときだけです。

```json
{ "id": "glitch", "displayName": "グリッチ",
  "stats": { "attack": 5, "defense": 4, "agility": 7 },
  "skills": ["blink", "boost_ring"], "commonSkill": "ball_summon",
  "assets": { "model": "chars/glitch.glb", "icon": "ui/icons/glitch.ktx2", "color": "#35F2FF" } }
```
```json
{ "id": "energy_bolt", "type": "active", "cost": 2, "cooldownSec": 8,
  "targeting": "reticle_nohoming",
  "effects": [ { "on": "hit_holding", "do": "force_drop_and_transfer_ball" },
               { "on": "hit_empty", "do": "stun", "durationSec": 0.5 } ],
  "vfx": "bolt_cyan" }
```

- スキルは効果部品の組み合わせで作ります：`buff_next_throw`、`place_zone`、`place_ring`、`projectile`、`stun`、`pull`、`teleport`、`illusion`、`ball_transfer`、`area_block`。
- きっかけは共通イベント：`throw`、`catch`、`parry`、`hit`、`step`、`count_tick`、`ball_cross_fence`。
- 補正式・球種・防御の定数は `data/balance.json` に集約。

**キャラ追加の完了条件**：①スキーマ検証が通る、②ステータス合計が上限以下、③妨害系は1つまで、④全スキルに VFX／SFX／アイコンの ID が揃う、⑤ボット10ラウンドのスモークテストでエラーなし、⑥人間のプレイテストメモを `docs/playtest/<id>.md` に記録。

---

## 16. 長期セッション向け CLAUDE.md

### 16.1 運用ルール（Claude Code 公式の方針に沿う）
- CLAUDE.md は**1ファイル200行以内**を目安に、具体的で確かめられる指示だけを書く。 [Claude Code Docs](https://code.claude.com/docs/en/memory)
- 領域別のルールは `.claude/rules/*.md` に分け、`paths` 指定で該当ファイルを触るときだけ読み込ませる（netcode、render、vfx、data）。 [Claude Code Docs](https://code.claude.com/docs/en/memory)
- `@path` インポートは起動時に読まれるので、整理にはなってもコンテキストの節約にはならない。 [Maketocreate](https://maketocreate.com/claude-md-best-practices-the-complete-2026-guide/)
- 直下の CLAUDE.md は `/compact` 後に再読込されるので、失いたくない原則はここに置く。 [codewithmukesh](https://codewithmukesh.com/blog/claude-md-mastery-dotnet/)
- **CLAUDE.md は指示であって強制ではない。** 絶対に守らせたいこと（main への直接 push 禁止、`data/balance.json` の無断変更禁止）は PreToolUse の hooks や `permissions.deny` で強制する。 [codewithmukesh](https://codewithmukesh.com/blog/claude-md-mastery-dotnet/)

### 16.2 CLAUDE.md ドラフト
```markdown
# CORE-CRUSH — Claude Code 作業ルール
## プロジェクト
- 1v1 FPS/TPS ドッジボール。Cloudflare Pages + WebRTC P2P。
- 設計の正本: docs/gdd/。迷ったらGDDを読み、矛盾する実装はしない。
- 体験の不変条件: docs/gdd/invariants.md（例: キャッチ空振り硬直 > 溜め+ストレート着弾）
## スタック
- TypeScript / Vite / three (three/webgpu, three/tsl) / Vitest / Playwright
## アーキテクチャ原則
- sim/（固定60Hz・three/DOM非依存）と render/ を分離。
- 数値は data/*.json のみ。マジックナンバー禁止。
- キャラ・スキルはデータ駆動。新キャラ追加で sim を変更しない（新効果部品のみ例外、要ADR）。
- ネットは受け手権威。判定は sim/judge/ に集約。
## コマンド
- npm run dev / test / test:sim / test:net / bench / validate:data
## 作業の流れ
1. 関連するGDD章とADRを読む → 2. 小さく変更 → test:sim → 必要なら bench
3. 設計判断は docs/decisions/NNNN-*.md（より良い手法を採った場合も）
4. 終了時に docs/progress.md へ「やったこと/次/未解決」を追記
## 禁止
- data/balance.json をプランナー承認なしに変更（提案は docs/proposals/）
- 試合中の new（プール必須）／25MiB超の単一アセット
## 詳細ルール
- .claude/rules/netcode.md, render.md, vfx.md, data.md（paths 指定）
```

---

## 17. hernes（harness-forge スキル）の活用計画

### 17.1 リポジトリの確認結果（README ベース）
- 実体は `.claude/skills/harness-forge/`。呼び出しは `/harness-forge <目的> [--mode auto|stop-gate|goal|headless|loop|workflow|routine] [--launch]`。 [github](https://github.com/Muaaaa849/hernes)
- 動作：目的を「タスク契約（done_when＝完了の証拠）」に変換 → プロファイル → 形の選択（L0〜L3×ループ／グラフ×起動方法）→ `.harness/<slug>/` に contract.yaml、verify.sh（done_when と1対1の証拠ゲート）、harness.json、gate.json、state.json、map.md、prompt.md、lessons.md、receipt.md、trace.jsonl、launch.md を生成し、読み取り専用の verifier エージェントも作る。 [github](https://github.com/Muaaaa849/hernes)
- hooks：`Stop`→stop_gate.py（verify.sh が exit 0 になるまで止めさせず、同じ失敗が N 回続けばエスカレーション）、`PreToolUse`→guard.py（検証器・契約の改ざんや破壊的操作を拒否）、`SessionStart`→session_context.py（圧縮・再開後に契約と教訓を再注入）、`PostToolUse`→trace_tool.py。 [github](https://github.com/Muaaaa849/hernes)
- 手順：①目的を契約に ②プロファイル ③形を選ぶ ④生成 ⑤ハーネスを証明（ベースラインが赤、感度、網羅、決定性、答えの漏れなし）⑥引き渡し。`--launch` を付けたときだけ即起動。 [github](https://github.com/Muaaaa849/hernes)
- 前提：python3、bash（headless や judge には claude CLI も）。クラウドのセッションは `~/.claude/skills/` を読まないため、**ゲームのリポジトリに `.claude/skills/harness-forge/` をコミットする**必要があります。 [github](https://github.com/Muaaaa849/hernes)
- 制約：`SKILL.md` 本文・`reference/patterns.md`・`docs/research-2026-09.md` の中身は取得できていません（ツールの制限）。モードの細部は導入時に SKILL.md で確認してください。

### 17.2 使いどころ
harness-forge が真価を発揮するのは**機械で合否を判定できる目的**です。「気持ちいいか」は verify.sh で判定できないため、**手触りは人間のプレイテスト、その前提となる数値の保証と退行防止はハーネス**と分担します。

### 17.3 工程ごとの指示文

| 工程 | 指示文 | mode | done_when の証拠 |
|---|---|---|---|
| 初期アーキテクチャ | `/harness-forge sim/（three非依存・固定60Hz）とrender/を分離した骨組みを作り、ボット同士が1ラウンド完走するヘッドレステストを通す --mode stop-gate` | stop-gate | test:sim が緑、sim/ に three/DOM の import なし、ボット戦完走 |
| 不変条件 | `/harness-forge docs/gdd/invariants.md の全不変条件（フリ→ストレート成立、ラリー上限+40%、8秒爆発、回避方向の相性）をテスト化し全て緑にする --mode stop-gate` | stop-gate | 条件ごとにテスト1つ。値を壊すと赤になる（感度） |
| データ駆動化 | `/harness-forge data/ のJSONスキーマを作り、コードのマジックナンバーを0にする --mode goal` | goal | validate:data が緑、数値リテラル検出0件 |
| 新規キャラ追加 | `/harness-forge glitch のキャラ/スキルJSONを追加し、simコード無変更でボット10ラウンド完走まで通す。条件はGDD 15章 --mode stop-gate` | stop-gate | sim/ の diff なし、スキーマとスモークが緑 |
| ネットコード | `/harness-forge 受け手権威のWebRTC 1v1を実装し、RTT 0/80/160ms・ロス0/2/5%で両者のイベントログが一致し、フリ→ストレート成立率が遅延0時の±5%以内になるようにする --mode stop-gate` | stop-gate | 遅延注入マトリクスが全て緑、ログのハッシュ一致 |
| 描画性能 | `/harness-forge 基準シーンのヘッドレスChrome計測でフレーム時間の中央値16.6ms以下・ドローコール150以下にする --mode loop` | loop | bench の JSON が予算内、WebGL との比較表 |
| VFX 最適化 | `/harness-forge VFXをプール化し、試合60秒中のGCアロケーション0・1エフェクト2000粒子以下にする --mode loop` | loop | ヒープ差分、粒子数ログ |
| 夜間の雑務 | `/harness-forge good-first-issue を片付ける --mode headless` | headless | 各 Issue の再現テストが緑 |

- 起動と停止：`python3 .harness/bin/harnessctl.py activate <slug> --gate stop` → `status` → `deactivate <slug>`。 [github](https://github.com/Muaaaa849/hernes)
- verify.sh と contract.yaml は保護対象（guard.py が改ざんを拒否）なので、**完了条件の変更は人間が契約を書き換えます**。receipt.md は「証明できたこと」だけを書くため、プランナーはこれを見て受け入れを判断します。 [github](https://github.com/Muaaaa849/hernes)
- より適した方法（Claude Code 標準の `/goal` や `/loop` の直接利用など）があれば採用して構いません。

---

## 18. 画像生成プラグイン（hex/claude-image-generation）の運用

### 18.1 重要：無料 API では画像を生成できない
- プラグインの既定モデルは `gemini-3-pro-image`（Nano Banana Pro）。ほかに `gemini-3.1-flash-image`（Nano Banana 2）、`gemini-3.1-flash-lite-image`（最安）が選べます。 [github](https://github.com/hex/claude-image-generation)
- **Google 公式の Gemini API 料金ページ（2026年9月30日確認）では、3モデルとも Free Tier 欄が「Not available」です。** 無料キーでは 429（free_tier の上限0）で失敗すると考えられます。 [Google AI](https://discuss.ai.google.dev/t/paid-tier-1-prepay-project-receives-free-tier-quota-limit-0-for-gemini-3-1-flash-image/182702)  [YingTu](https://yingtu.ai/en/blog/gemini-3-1-flash-image-preview-api) `gemini-2.5-flash-image` は公式料金ページで「2026年10月2日に提供終了」と明記されているので使いません。
- 選択肢：**A（推奨）課金を有効にして低価格モデルを使う。** 公式単価は flash-lite-image が1K画像あたり0.0336ドル、flash-image が1Kあたり0.067ドル、3-pro-image が1K／2Kあたり0.134ドル（1,120トークン相当）で、約150枚を Flash で作ればおよそ10ドル。**B** AI Studio のブラウザ画面で手動生成して取り込む（自動化は不可）。** [YingTu](https://yingtu.ai/en/blog/gemini-3-1-flash-image-preview-api) C** OpenRouter 経由（有料）。

### 18.2 導入と設定
```
/plugin marketplace add hex/claude-marketplace
/plugin install claude-image-generation
export GEMINI_API_KEY=...                          # Google AI Studioで発行
export GEMINI_IMAGE_MODEL=gemini-3.1-flash-image   # 量産用。キービジュアルのみ3-pro
```
- `/config` の Default providers は既定の `all` から `gemini` に変更（他プロバイダーの誤呼び出し防止）。Output directory は `art/generated/`。 [github](https://github.com/hex/claude-image-generation)
- 必要：curl、jq、base64。tmux 内ならプレビュー用ペインが開きます。 [github](https://github.com/hex/claude-image-generation)
- 呼び出しは `/generate-image <プロンプト>`、自動で動く `image-generator` エージェント、スクリプト直接実行（`bash scripts/gemini.sh --mode generate|edit --prompt --output --aspect-ratio --image-size 512|1K|2K|4K --input-image（最大14枚）`）の3通り。 [github](https://github.com/hex/claude-image-generation)
- Gemini の制約：**透過背景は非対応**（単色クロマキー背景で生成して切り抜く）。25文字未満の文字描画は得意。429／5xx は最大3回、指数バックオフで自動再試行。 [github](https://github.com/hex/claude-image-generation)

### 18.3 アセット別のプロンプト例

| アセット | 例 | 後処理 |
|---|---|---|
| キャラのコンセプト | `bash scripts/gemini.sh --mode generate --aspect-ratio 16:9 --image-size 2K --output art/generated/glitch_sheet.png --prompt "Turnaround sheet (front/side/back) of 'GLITCH', a lean cyborg dodgeball fighter in an illegal cyberpunk cage-fight league, cyan neon implants, junk-city techwear, anime-inspired, flat grey background, no text."` | 3Dモデル制作の資料 |
| 一貫した派生立ち絵 | `--input-image glitch_sheet.png --input-image style_ref.png --prompt "Image 1 is the character reference, image 2 the style reference. Dynamic throwing pose holding a glowing energy core..."` | 参照は「物体最大6＋キャラ最大5＋スタイル最大3」、役割をプロンプトで明記 | [github](https://github.com/hex/claude-image-generation)
| コアの表情アトラス | `--aspect-ratio 4:1 --prompt "Sprite strip of 4 LCD pixel-art faces on pure black: cheerful smile (cyan), nervous sweating (yellow), furious (red), cracked bursting (red/white). Readable at 64px, no text."` | 4コマに切り出して手修正→KTX2→LCDシェーダーで表示 |
| スキルアイコン | `/generate-image スキルアイコン「エナジーボルト」、円形フレームにシアンの稲妻弾、フラットで高コントラスト、単色マゼンタ背景、文字なし、1:1` | 背景を切り抜き→128/64px→アトラス化 |
| テクスチャ | `--image-size 2K --prompt "Seamless tileable rusted chain-link cage metal with neon grime, orthographic, even lighting, albedo only."` | シームレス確認→法線・粗さは別ツール→KTX2 |
| キービジュアル | `--model gemini-3-pro-image --image-size 4K --aspect-ratio 16:9`（ロゴは後から合成） | タイトル画面、ストアページ |

- `art/generated/` は下書き置き場。採用したものだけを `assets/` に移し、プロンプトとモデルを `art/prompts.md` に記録します（再現性のため）。
- 画像生成は2D素材と資料に限り、3Dモデルとアニメは別工程で作ります。より良い生成手段があれば採用可。

---

## 19. 開発ロードマップ

| M | 内容 | 完了の定義 |
|---|---|---|
| M0 技術検証 | WebGPU/WebGL ベンチ、Pointer Lock、DataChannel 往復 | 比較結果を ADR に |
| M1 ローカルの芯 | 箱キャラ＋ボットで球種・防御・カウント・カメラ | 不変条件テストが緑、「フリ→ストレート」が気持ちいい |
| M2 オンライン | Durable Objects シグナリング＋TURN＋受け手権威 | 遅延注入マトリクスが緑 |
| M3 見た目 | ステージ、ブルーム、フェンスとコアのシェーダー、VFX | 性能予算内で目標画質 |
| M4 キャラ | サンプル3キャラ、データ駆動スキル | 4体目がデータ追加だけで入る |
| M5 公開 | Cloudflare Pages、設定画面、チュートリアル | 初回ロード60MB以下、主要ブラウザで動作 |

---

## 20. 注意事項（前提と未検証の点）

- **画像生成の無料枠**：2026年9月30日時点で Gemini の画像モデルは全て無料枠外。料金とモデルは頻繁に変わるため、導入時に AI Studio で自分のプロジェクトの上限を確認してください。 [YingTu](https://yingtu.ai/en/blog/gemini-3-1-flash-image-preview-api)
- **hernes**：README と構成は確認済み、SKILL.md 本文は未読。モードの詳細や L0〜L3 の定義は導入時に確認してください。
- **未確認**：Durable Objects の無料枠の具体値、itch.io の容量制限。
- **参考作品**：BAKUDO は告知とプレビュー記事、Slappyball はストアとレビューに基づく整理で、実際のフレームデータは参照していません。
- **数値**：本書の数値は全て理論上の初期値です。プレイテストで調整し、変更は `data/balance.json` と ADR で管理してください。
- **全般**：どの推奨手法も、より良い手法があれば置き換えて構いません（0章の採用ルールに従う）。