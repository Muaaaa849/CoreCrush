// 計測ループ（renderer 非依存）。フレームごとに GPU 完了まで待ち、壁時計でフレーム時間を測る。
export interface BenchResult {
  renderer: string;
  backend: string;
  userAgent: string;
  width: number;
  height: number;
  frames: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  /** 影・ポストを含む総ドローコール（参考値） */
  drawCalls: number;
  /** シーン本体のドローコール（予算 ≤150 の対象。視錐台内の描画オブジェクト数） */
  sceneDrawCalls: number;
  triangles: number;
  note?: string;
}

export interface BenchTarget {
  renderer: string;
  backend: string;
  renderFrame(timeSec: number): void;
  waitGpu(): Promise<void>;
  stats(): { drawCalls: number; triangles: number };
  sceneDrawCalls(): number;
}

export interface BenchOptions {
  warmupFrames: number;
  measureFrames: number;
}

export const DEFAULT_BENCH_OPTIONS: BenchOptions = { warmupFrames: 60, measureFrames: 300 };

export function benchOptionsFromQuery(search: string): BenchOptions {
  const params = new URLSearchParams(search);
  return {
    warmupFrames: Number(params.get('warmup') ?? DEFAULT_BENCH_OPTIONS.warmupFrames),
    measureFrames: Number(params.get('frames') ?? DEFAULT_BENCH_OPTIONS.measureFrames),
  };
}

// 計測外でイベントループに制御を返す（同期 readPixels だけだとページが固まるため）
const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i] ?? NaN;
}

export async function runBench(
  target: BenchTarget,
  width: number,
  height: number,
  { warmupFrames, measureFrames }: BenchOptions = DEFAULT_BENCH_OPTIONS,
  onProgress?: (done: number, total: number) => void,
): Promise<BenchResult> {
  const total = warmupFrames + measureFrames;
  for (let i = 0; i < warmupFrames; i++) {
    target.renderFrame(i / 60);
    await target.waitGpu();
    onProgress?.(i + 1, total);
    await yieldToBrowser();
  }
  const times: number[] = [];
  let stats = { drawCalls: 0, triangles: 0 };
  for (let i = 0; i < measureFrames; i++) {
    const t0 = performance.now();
    target.renderFrame((warmupFrames + i) / 60);
    stats = target.stats();
    await target.waitGpu();
    times.push(performance.now() - t0);
    onProgress?.(warmupFrames + i + 1, total);
    await yieldToBrowser();
  }
  times.sort((a, b) => a - b);
  return {
    renderer: target.renderer,
    backend: target.backend,
    userAgent: navigator.userAgent,
    width,
    height,
    frames: measureFrames,
    medianMs: +percentile(times, 0.5).toFixed(3),
    p95Ms: +percentile(times, 0.95).toFixed(3),
    maxMs: +(times[times.length - 1] ?? NaN).toFixed(3),
    drawCalls: stats.drawCalls,
    sceneDrawCalls: target.sceneDrawCalls(),
    triangles: stats.triangles,
  };
}

export function publish(result: BenchResult | { error: string }): void {
  (window as unknown as { __benchResult: unknown }).__benchResult = result;
  const pre = document.getElementById('result');
  if (pre) pre.textContent = JSON.stringify(result, null, 2);
}
