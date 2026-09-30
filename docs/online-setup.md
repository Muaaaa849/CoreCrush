# オンライン対戦の準備（Cloudflare、ローカル環境なしで）

シグナリング Worker（`workers/signaling`）が **試作ページとシグナリングの両方** を配る。
デプロイすると `https://core-crush-signaling.<あなたのサブドメイン>.workers.dev/` を開くだけで対戦できる
（サーバー URL の入力は不要。同じ URL のページ同士がつながる）。

## 1. Worker を GitHub から作る（初回だけ）
1. Cloudflare にログイン（無料プランで可）→ **Workers & Pages** → **作成（Create）** → **リポジトリをインポート（Import a repository）**。
2. GitHub を連携し、`Muaaaa849/CoreCrush` を選ぶ。ブランチは `claude/zealous-fermat-dnuy3b`（いまのデフォルト）。
3. 設定:
   | 項目 | 値 |
   |---|---|
   | プロジェクト名（Worker 名） | `core-crush-signaling`（`wrangler.toml` の `name` と同じにする） |
   | ルートディレクトリ | 空欄（リポジトリのルート） |
   | ビルドコマンド | `npm ci && npm run proto:pages && cd workers/signaling && npm ci` |
   | デプロイコマンド | `cd workers/signaling && npx wrangler deploy` |
4. デプロイ。以後、このブランチに push するたびに自動で更新される。

画面の項目名が違っていたら、その画面の文言を教えてください（手順を直します）。

## 2. TURN（任意。つながらない回線のため）
STUN だけでも多くの家庭回線はつながる。会社・学校・一部のモバイル回線でつながらないときに設定する。
1. Cloudflare → **Realtime** → **TURN Server** → キーを作成。**Key ID** と **API Token** が出る。
2. Worker `core-crush-signaling` → **設定（Settings）** → **変数とシークレット（Variables and Secrets）** に
   `TURN_KEY_ID` と `TURN_KEY_API_TOKEN` を **シークレット** として追加。
   （トークンはリポジトリやページに書かない。Worker だけが持ち、ページには短命の資格情報だけを渡す）

## 3. 遊び方
1. 2人とも Worker の URL を開く。
2. 片方が「部屋を作る」→ 表示された部屋コードを相手に伝える。
3. もう片方がコードを入れて「参加」。「対戦中」になったらクリックでマウスをロックして開始。
- オンラインは一時停止できない（Esc でロックを外しても試合は進む）。再戦はページの再読み込み。
- claude.ai の Artifact 版はボット戦のみ（外部に接続するコードは Artifact の公開時検証を通らないため、`--no-online` で除いている）。オンラインは Worker の URL で。

## 開発者向け（ローカル）
- `npm run test:net` … 遅延注入マトリクス（ネットワーク不要）
- `npm run test:e2e:net` … `wrangler dev` と Chromium 2ページで実 WebRTC 越しのボット対戦
- `cd workers/signaling && npm run dev` … ローカルのシグナリング（先に `npm run proto:pages`）
