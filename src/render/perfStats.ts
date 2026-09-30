// 描画の性能計測（フレーム間隔・描画呼び出しの CPU 時間）。固定長のリングバッファでフレームごとの生成をしない。

export interface PerfSummary {
  frames: number;
  /** 平均 FPS（フレーム間隔の平均から） */
  fps: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  frameMsMax: number;
  /** フレーム間隔が 18ms を超えた割合（%）。GDD 12.3 の描画スケールを下げる目安 */
  over18Pct: number;
  /** 33ms（30fps 未満）を超えた割合（%） */
  over33Pct: number;
  /** view.render の CPU 時間（WebGPU は GPU 完了を待たないので、GPU の重さは frameMs に出る） */
  renderMsP50: number;
  renderMsP95: number;
}

export class PerfStats {
  private readonly frame: Float32Array;
  private readonly render: Float32Array;
  private readonly sorted: Float32Array;
  private n = 0;
  private head = 0;

  constructor(readonly capacity = 600) {
    this.frame = new Float32Array(capacity);
    this.render = new Float32Array(capacity);
    this.sorted = new Float32Array(capacity);
  }

  reset(): void {
    this.n = 0;
    this.head = 0;
  }

  get count(): number {
    return this.n;
  }

  push(frameMs: number, renderMs: number): void {
    this.frame[this.head] = frameMs;
    this.render[this.head] = renderMs;
    this.head = (this.head + 1) % this.capacity;
    if (this.n < this.capacity) this.n++;
  }

  /** 直近 n フレームの平均 FPS（表示用。軽い） */
  recentFps(n = 60): number {
    const k = Math.min(n, this.n);
    if (k === 0) return 0;
    let sum = 0;
    for (let i = 1; i <= k; i++) sum += this.frame[(this.head - i + this.capacity) % this.capacity]!;
    return sum > 0 ? (1000 * k) / sum : 0;
  }

  /** 直近のフレーム間隔の p95（表示用） */
  recentP95(n = 120): number {
    const k = Math.min(n, this.n);
    for (let i = 1; i <= k; i++) this.sorted[i - 1] = this.frame[(this.head - i + this.capacity) % this.capacity]!;
    return pct(this.sorted, k, 95);
  }

  summary(): PerfSummary {
    const n = this.n;
    let sum = 0;
    let over18 = 0;
    let over33 = 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const f = this.frame[i]!;
      sum += f;
      if (f > 18) over18++;
      if (f > 33) over33++;
      if (f > max) max = f;
    }
    this.sorted.set(this.frame.subarray(0, n));
    const p50 = pct(this.sorted, n, 50);
    const p95 = pct(this.sorted, n, 95);
    const p99 = pct(this.sorted, n, 99);
    this.sorted.set(this.render.subarray(0, n));
    const r50 = pct(this.sorted, n, 50);
    const r95 = pct(this.sorted, n, 95);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      frames: n,
      fps: n && sum > 0 ? r1((1000 * n) / sum) : 0,
      frameMsP50: r1(p50),
      frameMsP95: r1(p95),
      frameMsP99: r1(p99),
      frameMsMax: r1(max),
      over18Pct: n ? r1((100 * over18) / n) : 0,
      over33Pct: n ? r1((100 * over33) / n) : 0,
      renderMsP50: r1(r50),
      renderMsP95: r1(r95),
    };
  }
}

/** a[0..n) を並べ替えて百分位（最近傍順位） */
function pct(a: Float32Array, n: number, p: number): number {
  if (n === 0) return 0;
  const s = a.subarray(0, n);
  s.sort();
  const i = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return s[i]!;
}
