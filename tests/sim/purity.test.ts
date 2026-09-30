// CLAUDE.md「sim から three / DOM / performance.now / Date / Math.random を参照しない」の機械チェック
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/from ['"]three/, 'three の import'],
  [/\bdocument\./, 'DOM'],
  [/\bwindow\./, 'DOM'],
  [/performance\.now/, 'performance.now'],
  [/\bDate\b/, 'Date'],
  [/Math\.random/, 'Math.random'],
  [/from ['"]\.\.\/\.\.\/data|balance\.json/, 'data の直接 import（balance は引数で渡す）'],
];

describe('sim の純粋性', () => {
  for (const f of files('src/sim')) {
    it(f, () => {
      // コメントは対象外（説明文に禁止語が出てくるため）
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const [re, what] of FORBIDDEN) expect(re.test(src), `${f}: ${what}`).toBe(false);
    });
  }
});
