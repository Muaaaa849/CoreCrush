// M0 計測ラボ（claude.ai の Artifact として公開し、プランナーの実機で計測する）
// 結果は Artifact の db（コレクション m0Results）に保存し、実装担当が読み出す。
import { runWebGPUBench } from '../benchWebGPU';
import { runWebGLBench } from '../benchWebGL';
import { mountPointerLockTest } from '../pointerlock';
import { DEFAULT_BENCH_OPTIONS, type BenchResult } from '../benchRunner';

const FRAME_BUDGET_MS = 16.6;
const SCENE_DRAW_BUDGET = 150;
const COLLECTION = 'm0Results';

// --- Artifact db（最小の型。正本は claude.ai の型定義） ---
interface DocSnap { id: string; data(): Record<string, unknown> | undefined }
interface QuerySnap { docs: DocSnap[] }
interface Query {
  orderBy(field: string, dir?: 'asc' | 'desc'): Query;
  limit(n: number): Query;
  onSnapshot(next: (s: QuerySnap) => void, error?: (e: unknown) => void): () => void;
}
interface Collection extends Query { add(data: Record<string, unknown>): Promise<unknown> }
interface Db { collection(path: string): Collection }
type ClaudeWin = { claude?: { use?: (name: string) => Promise<unknown> } };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TESTS = [
  { id: 'webgpu', name: 'WebGPURenderer · WebGPU', desc: 'GDD の推奨構成。TSL のブルームと SMAA。' },
  { id: 'webgpu-webgl2', name: 'WebGPURenderer · WebGL2 強制', desc: '同じコードを WebGL2 で動かす。WebGPU が遅いときの第一候補。' },
  { id: 'webgl', name: 'WebGLRenderer（従来）', desc: '比較用。TSL が使えないので、切り替えると VFX を作り直すことになる。' },
] as const;
type TestId = (typeof TESTS)[number]['id'];

const results: Record<string, unknown> = {};
let db: Db | null = null;
let gpuInfo: Record<string, string> = {};

function device(): string {
  return $<HTMLInputElement>('device').value.trim() || '未入力';
}

function renderTests(): void {
  const host = $('tests');
  host.replaceChildren(
    ...TESTS.map((t) => {
      const el = document.createElement('div');
      el.className = 'test';
      el.innerHTML = `<div class="name"></div><span class="pill" data-state="idle">未実行</span><div class="desc"></div><div class="figures"></div>`;
      el.querySelector('.name')!.textContent = t.name;
      el.querySelector('.desc')!.textContent = t.desc;
      el.id = `test-${t.id}`;
      return el;
    }),
  );
}

function setTest(id: TestId, state: 'idle' | 'running' | 'ok' | 'over' | 'error', label: string, figures = ''): void {
  const el = $(`test-${id}`);
  const pill = el.querySelector('.pill') as HTMLElement;
  pill.dataset.state = state;
  pill.textContent = label;
  (el.querySelector('.figures') as HTMLElement).textContent = figures;
}

function describe(r: BenchResult): string {
  return `中央値 ${r.medianMs}ms · p95 ${r.p95Ms}ms · 本体DC ${r.sceneDrawCalls}（総 ${r.drawCalls}） · ${Math.round(r.triangles / 1000)}k tris · backend=${r.backend}${r.note ? ` · ${r.note}` : ''}`;
}

async function save(test: string, result: unknown): Promise<boolean> {
  results[test] = result;
  $('jsonOut').textContent = JSON.stringify({ device: device(), gpu: gpuInfo, results }, null, 2);
  if (!db) return false;
  await db.collection(COLLECTION).add({ test, device: device(), gpu: gpuInfo, userAgent: navigator.userAgent, result, createdAt: Date.now() });
  return true;
}

function saveMessage(el: HTMLElement, ok: boolean, error?: unknown): void {
  el.dataset.state = error ? 'error' : ok ? 'ok' : '';
  el.textContent = error ? `保存できませんでした: ${String(error)}` : ok ? '保存しました' : '保存先がないため、下の JSON をコピーして送ってください';
}

async function runAll(): Promise<void> {
  const button = $<HTMLButtonElement>('runAll');
  button.disabled = true;
  const stage = $('stage');
  const msg = $('benchSave');
  msg.textContent = '';
  let saveError: unknown;
  let saved = true;
  for (const t of TESTS) {
    stage.replaceChildren();
    setTest(t.id, 'running', '計測中 0%');
    const progress = (done: number, total: number) => setTest(t.id, 'running', `計測中 ${Math.floor((done / total) * 100)}%`);
    try {
      const r =
        t.id === 'webgl'
          ? await runWebGLBench(stage, DEFAULT_BENCH_OPTIONS, progress)
          : await runWebGPUBench(stage, t.id === 'webgpu-webgl2', DEFAULT_BENCH_OPTIONS, progress);
      const within = r.medianMs <= FRAME_BUDGET_MS && r.sceneDrawCalls <= SCENE_DRAW_BUDGET;
      setTest(t.id, within ? 'ok' : 'over', within ? '予算内' : '予算超過', describe(r));
      try { saved = (await save(t.id, r)) && saved; } catch (e) { saveError = e; }
    } catch (e) {
      setTest(t.id, 'error', '失敗', String(e));
      try { saved = (await save(t.id, { error: String(e) })) && saved; } catch (e2) { saveError = e2; }
    }
  }
  stage.textContent = '計測が終わりました';
  saveMessage(msg, saved, saveError);
  button.disabled = false;
}

async function readGpuInfo(): Promise<void> {
  const info: Record<string, string> = {};
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const a = adapter.info;
        info.webgpu = [a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' / ') || '対応（詳細非公開）';
      } else info.webgpu = 'アダプタなし';
    } catch (e) {
      info.webgpu = `エラー: ${String(e)}`;
    }
  } else info.webgpu = '非対応';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    info.webgl = gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : '非対応';
  } catch (e) {
    info.webgl = `エラー: ${String(e)}`;
  }
  gpuInfo = info;
  const dl = $('gpuInfo');
  dl.replaceChildren();
  for (const [k, v] of Object.entries({ 'WebGPU': info.webgpu ?? '', 'WebGL2': info.webgl ?? '', 'ブラウザ': navigator.userAgent })) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
}

function renderHistory(docs: DocSnap[]): void {
  const body = $('history');
  body.replaceChildren(
    ...docs.map((d) => {
      const v = d.data() ?? {};
      const r = (v.result ?? {}) as Partial<BenchResult> & { error?: string; mousemovePerSec?: number; unadjustedMovement?: string };
      const tr = document.createElement('tr');
      const cells =
        v.test === 'pointerlock'
          ? [`生入力 ${r.unadjustedMovement ?? '-'}`, `${r.mousemovePerSec ?? '-'} ev/s`, '', '']
          : r.error
            ? ['失敗', '', '', '']
            : [String(v.test ?? ''), `${r.medianMs ?? '-'}ms`, `${r.p95Ms ?? '-'}ms`, String(r.sceneDrawCalls ?? '-')];
      if (v.test === 'pointerlock') cells[0] = 'pointerlock';
      const when = new Date(Number(v.createdAt ?? 0)).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      for (const c of [when, String(v.device ?? ''), ...cells]) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.append(td);
      }
      if (v.test === 'pointerlock') (tr.children[3] as HTMLElement).textContent = `生入力 ${r.unadjustedMovement ?? '-'} · ${r.mousemovePerSec ?? '-'} ev/s`;
      return tr;
    }),
  );
}

function showFallback(reason: string): void {
  $('dbStatus').textContent = reason;
  $('fallback').hidden = false;
  $('jsonOut').hidden = false;
}

async function connectDb(): Promise<void> {
  const use = (window as unknown as ClaudeWin).claude?.use;
  const ns = use ? ((await use('db').catch(() => null)) as Db | null) : null;
  if (!ns) {
    showFallback('この表示では結果を自動保存できません。計測後に JSON をコピーしてチャットに貼ってください。');
    return;
  }
  db = ns;
  $('dbStatus').textContent = '結果は自動で保存されます（新しい順に20件）。';
  db.collection(COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .onSnapshot(
      (s) => renderHistory(s.docs),
      (e) => showFallback(`保存先に接続できませんでした（${String(e)}）。JSON をコピーして送ってください。`),
    );
}

function init(): void {
  const input = $<HTMLInputElement>('device');
  try { input.value = localStorage.getItem('m0.device') ?? ''; } catch { /* 保存できない環境 */ }
  input.addEventListener('change', () => {
    try { localStorage.setItem('m0.device', input.value); } catch { /* 保存できない環境 */ }
  });

  renderTests();
  $('runAll').addEventListener('click', () => void runAll());

  const snapshot = mountPointerLockTest($('lockpad'));
  const plOut = $('plOut');
  const tick = () => {
    plOut.textContent = JSON.stringify(snapshot(), null, 2);
    requestAnimationFrame(tick);
  };
  tick();
  $('plSave').addEventListener('click', async () => {
    const el = $('plSaveMsg');
    try { saveMessage(el, await save('pointerlock', snapshot())); } catch (e) { saveMessage(el, false, e); }
  });

  $('copyJson').addEventListener('click', async () => {
    const text = $('jsonOut').textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      $('copyMsg').textContent = 'コピーしました';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('jsonOut'));
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      $('copyMsg').textContent = '選択しました。Ctrl+C でコピーしてください';
    }
  });

  void readGpuInfo();
  void connectDb();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
