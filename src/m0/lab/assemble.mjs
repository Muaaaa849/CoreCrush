// dist-lab/lab.js を template.html に埋め込み、Artifact として公開する1枚の HTML を作る
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const out = resolve(here, '../../../dist-lab');
const js = readFileSync(resolve(out, 'lab.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(here, 'template.html'), 'utf8').replace('/*__LAB_BUNDLE__*/', () => js);
writeFileSync(resolve(out, 'm0-lab.html'), html);
console.log(`dist-lab/m0-lab.html ${(html.length / 1024).toFixed(0)} KiB`);
