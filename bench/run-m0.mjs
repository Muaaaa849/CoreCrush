// M0 検証ページをヘッドレス Chromium で実行し、結果 JSON を集める（CI/クラウド用の動作確認）。
// 実機の性能判断には使わない（GPU なし環境ではソフトウェア描画になる）。
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { writeFileSync } from 'node:fs';

// ヘッドレス（ソフトウェア描画）では遅いのでフレーム数を減らす
const q = 'warmup=10&frames=60';
const pages = [
  `m0/bench-webgpu.html?${q}`,
  `m0/bench-webgpu.html?forceWebGL=1&${q}`,
  `m0/bench-webgl.html?${q}`,
  'm0/datachannel.html',
];
const server = await preview({ preview: { port: 4173, strictPort: true } });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const out = {};
for (const p of pages) {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error(`[${p}]`, m.text()));
  await page.goto(`http://localhost:4173/${p}`, { waitUntil: 'commit', timeout: 120_000 });
  await page.waitForFunction(() => window.__benchResult !== undefined, null, { timeout: 600_000 });
  out[p] = await page.evaluate(() => window.__benchResult);
  console.log(p, JSON.stringify(out[p]));
  await page.close();
}
await browser.close();
server.httpServer.close();
const file = process.argv[2] ?? 'bench/results/m0-headless.local.json';
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('saved', file);
