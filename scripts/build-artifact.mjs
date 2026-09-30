// 1ファイルの Artifact 用 HTML を作る: エントリを IIFE にまとめ、テンプレートの /*__BUNDLE__*/ に埋め込む。
// 使い方: node scripts/build-artifact.mjs <entry.ts> <template.html> <out.html> [--no-online]
// --no-online: オンライン対戦のコードを除く（claude.ai Artifact 版。公開時の検証で外部接続のコードが通らないため）
import { build } from 'vite';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const online = !args.includes('--no-online');
const [entry, template, out] = args.filter((a) => !a.startsWith('--'));
if (!entry || !template || !out) {
  console.error('usage: node scripts/build-artifact.mjs <entry.ts> <template.html> <out.html>');
  process.exit(2);
}
const tmp = mkdtempSync(resolve(tmpdir(), 'cc-artifact-'));
await build({
  configFile: false,
  logLevel: 'warn',
  define: { __ONLINE__: JSON.stringify(online) },
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
