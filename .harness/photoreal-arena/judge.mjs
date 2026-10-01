// 見た目の盲検評価（.harness/photoreal-arena）。PROTECTED: ビルダーは編集しない。
// 使い方: node .harness/photoreal-arena/judge.mjs <撮影ディレクトリ> [回数=3]
// 前提知識を与えないため、画像だけを一時ディレクトリに複製し、そこで Sonnet 5.5 を headless で独立に N 回起動する（プロジェクトの CLAUDE.md・コードは見えない）。
// 中央値が THRESHOLD 以上、かつ過半数が「主要物が読める」と答えたら exit 0。結果は judge/<時刻>/ と judge/latest.json・feedback.md に残す。
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const THRESHOLD = 80;
const MODEL = 'claude-sonnet-5-5';
const shotsDir = resolve(process.argv[2] ?? '.harness/photoreal-arena/shots');
const runs = Number(process.argv[3] ?? 3);
const judgeRoot = resolve('.harness/photoreal-arena/judge');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(judgeRoot, stamp);
await mkdir(outDir, { recursive: true });

const images = (await readdir(shotsDir)).filter((f) => f.endsWith('.png')).sort();
if (images.length === 0) {
  console.error('撮影画像がない');
  process.exit(2);
}

const prompt = (dir) => `You are a veteran art director at a top-tier AAA game studio. You will review ${images.length} gameplay screenshots (1280x720) of ONE real-time 3D game. You know nothing else about the game; judge only what you see.
Use the Read tool to open every image: ${images.map((f) => join(dir, f)).join(', ')}

1) Score the visual quality as a percentage of "SSS tier" — the very best-looking real-time games today (for calibration: Cyberpunk 2077 with path tracing, The Last of Us Part II, Hellblade II, Black Myth: Wukong, Ghost of Tsushima).
   100 = indistinguishable from those; 80 = clearly AAA, only experts spot the gap; 60 = good AA / strong indie; 40 = average indie; 20 = prototype / programmer art.
   Be strict and calibrated. Do not reward effort or intention; judge the pixels. The HUD is part of the game screen.
2) List concretely what makes it look cheap compared to SSS tier: what, where (image file name), why it reads as cheap, and a specific technical fix (rendering, lighting, materials, models, composition, post-processing, color grading, UI). Most impactful first, at most 12.
3) Gameplay readability: is the small glowing ball/orb and the opponent clearly readable against the background? (true/false)

Write every free-text field in Japanese. Output ONLY one JSON object, no markdown fence:
{"score": <integer 0-100>, "summary_ja": "...", "cheap_points": [{"rank": 1, "impact": "high|mid|low", "what_ja": "...", "where": "front.png", "why_ja": "...", "fix_ja": "..."}], "strengths_ja": ["..."], "readable": true, "readability_note_ja": "..."}`;

function runOne(i) {
  return new Promise(async (res) => {
    // 各回ごとに別の一時ディレクトリ（他の回の結果も見えない）
    const dir = await mkdtemp(join(tmpdir(), 'cc-judge-'));
    for (const f of images) await copyFile(join(shotsDir, f), join(dir, f));
    execFile(
      'claude',
      ['-p', '--model', MODEL, '--allowedTools', 'Read', '--output-format', 'json', prompt(dir)],
      { cwd: dir, env: { ...process.env, HARNESS_NESTED: '1' }, timeout: 600000, maxBuffer: 16 * 1024 * 1024 },
      async (err, stdout) => {
        await rm(dir, { recursive: true, force: true });
        let parsed = null;
        let raw = '';
        try {
          const env = JSON.parse(stdout);
          raw = env.result ?? '';
          const m = raw.match(/\{[\s\S]*\}/);
          parsed = m ? JSON.parse(m[0]) : null;
          if (parsed) parsed.cost_usd = env.total_cost_usd;
        } catch {
          raw = String(stdout || err);
        }
        await writeFile(join(outDir, `run${i + 1}.json`), JSON.stringify(parsed ?? { error: raw.slice(0, 2000) }, null, 1));
        res(parsed);
      },
    );
  });
}

const results = (await Promise.all(Array.from({ length: runs }, (_, i) => runOne(i)))).filter((r) => r && Number.isFinite(r.score));
if (results.length === 0) {
  console.error('評価が 1 件も得られなかった（judge の出力を確認）');
  process.exit(2);
}
const scores = results.map((r) => r.score).sort((a, b) => a - b);
const median = scores[Math.floor(scores.length / 2)];
const readableVotes = results.filter((r) => r.readable === true).length;
const readable = readableVotes * 2 > results.length;
const pass = median >= THRESHOLD && readable && results.length === runs;

// ビルダー向けのまとめ（全員の指摘を影響度順に並べる）
const order = { high: 0, mid: 1, low: 2 };
const points = results.flatMap((r, i) => (r.cheap_points ?? []).map((p) => ({ ...p, judge: i + 1 })))
  .sort((a, b) => (order[a.impact] ?? 3) - (order[b.impact] ?? 3) || a.rank - b.rank);
const md = [
  `# 盲検評価 ${stamp}`,
  `- スコア: ${scores.join(' / ')}（中央値 ${median}、合格 ${THRESHOLD} 以上） 主要物が読める: ${readableVotes}/${results.length}`,
  `- 判定: ${pass ? 'PASS' : 'FAIL'}`,
  '',
  '## 要約',
  ...results.map((r, i) => `- 評価者${i + 1}（${r.score}）: ${r.summary_ja ?? ''}`),
  '',
  '## チープに見える点（影響度順）',
  ...points.map((p) => `- [${p.impact}] (${p.where}) ${p.what_ja} — ${p.why_ja}\n  - 直し方: ${p.fix_ja}`),
  '',
  '## 良い点',
  ...results.flatMap((r) => (r.strengths_ja ?? []).map((s) => `- ${s}`)),
  '',
  '## 可読性',
  ...results.map((r, i) => `- 評価者${i + 1}: ${r.readable ? '読める' : '読めない'} — ${r.readability_note_ja ?? ''}`),
].join('\n');
const summary = { stamp, scores, median, readableVotes, runs: results.length, pass, cost_usd: results.reduce((s, r) => s + (r.cost_usd ?? 0), 0) };
await writeFile(join(outDir, 'feedback.md'), md);
await writeFile(join(judgeRoot, 'feedback.md'), md);
await writeFile(join(judgeRoot, 'latest.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
process.exit(pass ? 0 : 1);
