# bench

- `npm run m0:headless` — M0 検証ページをヘッドレス Chromium で実行し `bench/results/m0-headless.local.json` に保存。
  GPU のない環境ではソフトウェア描画になるため、**動作確認用**。性能判断には実機の結果を使う。
  クラウド環境ではプリインストールの Chromium を使う: `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run m0:headless`
- 実機計測: `npm run dev` → 表示されるトップページのリンクから各ページを開き、表示された JSON を
  `bench/results/<日付>-<機種>.json` として保存する。
