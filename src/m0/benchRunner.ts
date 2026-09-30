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
  drawCalls: number;
  triangles: number;
  note?: string;
}

export interface BenchTarget {
  renderer: string;
  backend: string;
  renderFrame(timeSec: number): void;
  waitGpu(): Promise<void>;
  stats(): { drawCalls: number; triangles: number };
}

const params = new URLSearchParams(location.search);
const WARMUP_FRAMES = Number(params.get('warmup') ?? 60);
const MEASURE_FRAMES = Number(params.get('frames') ?? 300);

// 計測外でイベントループに制御を返す（同期 readPixels だけだとページが固まるため）
const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i] ?? NaN;
}

export async function runBench(target: BenchTarget, width: number, height: number): Promise<BenchResult> {
  for (let i = 0; i < WARMUP_FRAMES; i++) {
    target.renderFrame(i / 60);
    await target.waitGpu();
    await yieldToBrowser();
  }
  const times: number[] = [];
  let stats = { drawCalls: 0, triangles: 0 };
  for (let i = 0; i < MEASURE_FRAMES; i++) {
    const t0 = performance.now();
    target.renderFrame((WARMUP_FRAMES + i) / 60);
    stats = target.stats();
    await target.waitGpu();
    times.push(performance.now() - t0);
    await yieldToBrowser();
  }
  times.sort((a, b) => a - b);
  return {
    renderer: target.renderer,
    backend: target.backend,
    userAgent: navigator.userAgent,
    width,
    height,
    frames: MEASURE_FRAMES,
    medianMs: +percentile(times, 0.5).toFixed(3),
    p95Ms: +percentile(times, 0.95).toFixed(3),
    maxMs: +(times[times.length - 1] ?? NaN).toFixed(3),
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
  };
}

export function publish(result: BenchResult | { error: string }): void {
  (window as unknown as { __benchResult: unknown }).__benchResult = result;
  const pre = document.getElementById('result');
  if (pre) pre.textContent = JSON.stringify(result, null, 2);
}
