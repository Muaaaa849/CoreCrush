// 試作ページを workers/signaling/public/index.html に置く（Worker の静的アセットとして配る）
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const built = resolve(root, 'dist-lab/core-crush-proto.html');
const r = spawnSync('node', ['scripts/build-artifact.mjs', 'src/proto/main.ts', 'src/proto/template.html', built], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
const dir = resolve(root, 'workers/signaling/public');
mkdirSync(dir, { recursive: true });
// テンプレートは Artifact 用の断片（Artifact 側が文書の骨組みを足す）。Worker で配るときは自分で骨組みを付ける
// （付けないと文字コードが決まらず日本語が化ける）
const body = readFileSync(built, 'utf8');
const html = body.trimStart().toLowerCase().startsWith('<!doctype')
  ? body
  : `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
writeFileSync(resolve(dir, 'index.html'), html);
console.log('workers/signaling/public/index.html');
