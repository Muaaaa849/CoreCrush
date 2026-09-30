// 1ファイルの Artifact 用 HTML を作る: エントリを IIFE にまとめ、テンプレートの /*__BUNDLE__*/ に埋め込む。
// 使い方: node scripts/build-artifact.mjs <entry.ts> <template.html> <out.html> [--no-online]
// --no-online: オンライン対戦のコードを除く（claude.ai Artifact 版。公開時の検証で外部接続のコードが通らないため）
// --server=<URL>: シグナリングサーバーの既定値（ページと別オリジンで配るとき。GitHub Pages 版）
import { build } from 'vite';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const online = !args.includes('--no-online');
const server = args.find((a) => a.startsWith('--server='))?.slice('--server='.length) ?? '';
// 版番号（画面に出して、古い版が表示されていないかを見分ける）
let buildId = (process.env.GITHUB_SHA ?? process.env.WORKERS_CI_COMMIT_SHA)?.slice(0, 7) ?? '';
if (!buildId) {
  try {
    buildId = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    buildId = 'dev';
  }
}
const [entry, template, out] = args.filter((a) => !a.startsWith('--'));
if (!entry || !template || !out) {
  console.error('usage: node scripts/build-artifact.mjs <entry.ts> <template.html> <out.html>');
  process.exit(2);
}
const tmp = mkdtempSync(resolve(tmpdir(), 'cc-artifact-'));
await build({
  configFile: false,
  logLevel: 'warn',
  // import.meta.url: 1 ファイルに埋め込むと元の URL がないので、ページの URL を使う（KTX2Loader が読み込み時に URL を組む）
  define: { __ONLINE__: JSON.stringify(online), __DEFAULT_SERVER__: JSON.stringify(server), __BUILD__: JSON.stringify(buildId), 'import.meta.url': 'document.baseURI' },
  build: {
    outDir: tmp,
    emptyOutDir: true,
    target: 'es2022',
    lib: { entry: resolve(entry), formats: ['iife'], name: 'CoreCrushArtifact', fileName: () => 'bundle.js' },
  },
});
const js = readFileSync(resolve(tmp, 'bundle.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
rmSync(tmp, { recursive: true, force: true });
const html = readFileSync(resolve(template), 'utf8').replace('/*__BUNDLE__*/', () => js);
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), html);
console.log(`${out} ${(html.length / 1024).toFixed(0)} KiB`);
