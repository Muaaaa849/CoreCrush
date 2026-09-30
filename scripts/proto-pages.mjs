// 試作ページ（オンライン込み）を作る。
// 既定: workers/signaling/public/index.html（Worker の静的アセットとして配る）
// --out=<dir> --server=<URL>: 別の置き場所（GitHub Pages 版は dist-pages、シグナリングは workers.dev を既定にする）
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const built = resolve(root, 'dist-lab/core-crush-proto.html');
const opt = (name) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const server = opt('server');
const r = spawnSync('node', ['scripts/build-artifact.mjs', 'src/proto/main.ts', 'src/proto/template.html', built, ...(server ? [`--server=${server}`] : [])], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
const dir = resolve(root, opt('out') ?? 'workers/signaling/public');
mkdirSync(dir, { recursive: true });
// テンプレートは Artifact 用の断片（Artifact 側が文書の骨組みを足す）。Worker で配るときは自分で骨組みを付ける
// （付けないと文字コードが決まらず日本語が化ける）
const body = readFileSync(built, 'utf8');
const html = body.trimStart().toLowerCase().startsWith('<!doctype')
  ? body
  : `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
writeFileSync(resolve(dir, 'index.html'), html);
console.log(resolve(dir, 'index.html'));
