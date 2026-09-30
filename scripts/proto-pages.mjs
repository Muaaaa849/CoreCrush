// 試作ページを workers/signaling/public/index.html に置く（Worker の静的アセットとして配る）
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const built = resolve(root, 'dist-lab/core-crush-proto.html');
const r = spawnSync('node', ['scripts/build-artifact.mjs', 'src/proto/main.ts', 'src/proto/template.html', built], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
const dir = resolve(root, 'workers/signaling/public');
mkdirSync(dir, { recursive: true });
copyFileSync(built, resolve(dir, 'index.html'));
console.log('workers/signaling/public/index.html');
