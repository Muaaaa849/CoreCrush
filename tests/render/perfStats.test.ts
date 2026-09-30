// 性能計測の集計（百分位・閾値超えの割合）
import { describe, expect, it } from 'vitest';
import { PerfStats } from '../../src/render/perfStats';

describe('PerfStats', () => {
  it('一定のフレーム間隔なら FPS と百分位がその値になる', () => {
    const s = new PerfStats(100);
    for (let i = 0; i < 100; i++) s.push(1000 / 60, 2);
    const r = s.summary();
    expect(r.frames).toBe(100);
    expect(r.fps).toBeCloseTo(60, 0);
    expect(r.frameMsP50).toBeCloseTo(16.7, 1);
    expect(r.over18Pct).toBe(0);
    expect(r.renderMsP95).toBe(2);
  });

  it('遅いフレームは p95・p99・最大と閾値超えの割合に出る', () => {
    const s = new PerfStats(100);
    for (let i = 0; i < 90; i++) s.push(16, 1);
    for (let i = 0; i < 10; i++) s.push(40, 5);
    const r = s.summary();
    expect(r.frameMsP50).toBe(16);
    expect(r.frameMsP95).toBe(40);
    expect(r.frameMsMax).toBe(40);
    expect(r.over18Pct).toBe(10);
    expect(r.over33Pct).toBe(10);
  });

  it('容量を超えたら古いものから捨て、直近の FPS は新しいフレームだけで出す', () => {
    const s = new PerfStats(10);
    for (let i = 0; i < 10; i++) s.push(50, 0);
    for (let i = 0; i < 10; i++) s.push(10, 0);
    expect(s.count).toBe(10);
    expect(s.summary().fps).toBe(100);
    expect(s.recentFps(5)).toBeCloseTo(100);
  });

  it('空でも壊れない', () => {
    const s = new PerfStats(10);
    expect(s.summary().fps).toBe(0);
    expect(s.recentFps()).toBe(0);
    expect(s.recentP95()).toBe(0);
  });
});
