// 見た目の評価ハーネス（.harness/photoreal-arena）の撮影。PROTECTED: ビルダーは視点を変えない（良く見える角度だけを選ばせないため）。
// 使い方: node .harness/photoreal-arena/capture.mjs <出力ディレクトリ>
// dist-pages（npm run proto:gh-pages の出力）を静的配信し、決まった視点で撮る。meta.json に描画数・エラーを書く。
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist-pages');
const out = resolve(process.argv[2] ?? '.harness/photoreal-arena/shots');
await mkdir(out, { recursive: true });

// 視点（px, pz: 自分の位置 m、yaw/pitch: ラジアン。自分は z<0 側で +z を向くと相手コート）
const VIEWS = [
  { id: 'front', px: 0, pz: -14, yaw: 0, pitch: -0.05 },
  { id: 'side', px: -4, pz: -10, yaw: 1.35, pitch: 0.02 },
  { id: 'corner', px: 7, pz: -21, yaw: -0.45, pitch: 0.12 },
  { id: 'fence', px: 3, pz: -2.5, yaw: -0.25, pitch: 0.0 },
  { id: 'back', px: -2, pz: -4, yaw: 3.0, pitch: -0.08 },
];

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = join(root, p === '/' ? 'index.html' : p);
    if (!f.startsWith(root)) throw new Error('outside');
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const meta = { views: {}, errors: [] };
try {
  // 1 回だけ読み込み（テクスチャの変換が重い）、視点は __ccSetShot で切り替える
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => meta.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_CERT|status of 404/.test(m.text())) meta.errors.push(m.text().slice(0, 300));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon|fonts\.g/.test(r.url())) meta.errors.push(`${r.status()} ${r.url()}`);
  });
  await page.addInitScript(() => {
    localStorage.setItem('cc.quality', JSON.stringify('high'));
    localStorage.setItem('cc.bot', JSON.stringify('dummy'));
  });
  const v0 = VIEWS[0];
  await page.goto(`http://127.0.0.1:${port}/index.html?shot=1&px=${v0.px}&pz=${v0.pz}&yaw=${v0.yaw}&pitch=${v0.pitch}`);
  let token = 1;
  await page.waitForFunction(() => document.documentElement.dataset.shot === '1', null, { timeout: 300000 });
  for (const [i, v] of VIEWS.entries()) {
    if (i > 0) {
      await page.evaluate((v) => window.__ccSetShot(v), { px: v.px, pz: v.pz, yaw: v.yaw, pitch: v.pitch });
      token++;
      await page.waitForFunction((t) => document.documentElement.dataset.shot === String(t), token, { timeout: 120000 });
    }
    await page.screenshot({ path: join(out, `${v.id}.png`) });
    meta.views[v.id] = await page.evaluate(() => window.__ccShot);
  }
  await page.close();
} finally {
  await browser.close();
  server.close();
}
await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
