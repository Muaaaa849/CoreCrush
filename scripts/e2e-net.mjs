// e2e: ローカルのシグナリング Worker（wrangler dev）＋ヘッドレス Chromium 2ページで、実際の WebRTC 越しにボット対戦し、
// 両ページの確定イベントログ・勝敗が一致することを確かめる。使い方: npm run test:e2e:net
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist-lab/e2e-net.html');
const b = spawnSync('node', ['scripts/build-artifact.mjs', 'tests/e2e/netPage.ts', 'tests/e2e/net.html', out], { cwd: root, stdio: 'inherit' });
if (b.status !== 0) process.exit(1);

const workerDir = resolve(root, 'workers/signaling');
const wrangler = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8787'], { cwd: workerDir, stdio: ['ignore', 'pipe', 'pipe'] });
const html = readFileSync(out);
const http = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); }).listen(5190);

async function waitWorker() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://localhost:8787/')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('wrangler dev が起動しない');
}

let code = 1;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
try {
  await waitWorker();
  const room = 'E2E' + Math.floor(Math.random() * 1e6);
  const url = `http://localhost:5190/?room=${room}&server=http://localhost:8787`;
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  for (const p of pages) p.on('pageerror', (e) => console.error('pageerror', e));
  await pages[0].goto(url);
  await new Promise((r) => setTimeout(r, 500));
  await pages[1].goto(url);
  const results = await Promise.all(pages.map((p) => p.waitForFunction(() => window.__result, null, { timeout: 240000 }).then((h) => h.jsonValue())));
  for (const r of results) if ('error' in r) throw new Error(r.error);
  const [a, c] = results;
  console.log(`roles ${a.role}/${c.role} ticks ${a.ticks}/${c.ticks} winner ${a.winner}/${c.winner} rounds ${a.rounds} | ${c.rounds} log ${a.log.split('\n').length} 行`);
  if (a.winner !== c.winner || a.rounds !== c.rounds || a.log !== c.log) throw new Error('両ページの結果が一致しない');
  console.log('OK  実 WebRTC 越しのボット対戦で、勝敗・ラウンド結果・確定イベントログが一致');
  code = 0;
} catch (e) {
  console.error('NG ', e.message ?? e);
} finally {
  await browser.close();
  http.close();
  wrangler.kill();
}
process.exit(code);
