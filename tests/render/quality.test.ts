// 画質段階（Q-31 回答）: 段階の選び方と「自動」の描画解像度の段階的低下
import { describe, expect, it } from 'vitest';
import { AutoResolution, QUALITY, parseQualitySetting, pixelRatioFor, resolveTier } from '../../src/render/quality';

const auto = { overFrameMs: 18, windowF: 10, dropOverPct: 50, scaleSteps: [1, 0.9, 0.75] };
const feed = (a: AutoResolution, ms: number, n: number) => {
  let changed = 0;
  for (let i = 0; i < n; i++) if (a.push(ms)) changed++;
  return changed;
};

describe('画質段階', () => {
  it('自動はタッチ端末で中、PC で高から始める（Q-31）', () => {
    expect(resolveTier('auto', true)).toBe('mid');
    expect(resolveTier('auto', false)).toBe('high');
    expect(resolveTier('low', false)).toBe('low');
  });

  it('知らない値は自動として扱う', () => {
    expect(parseQualitySetting('ultra')).toBe('auto');
    expect(parseQualitySetting(null)).toBe('auto');
    expect(parseQualitySetting('mid')).toBe('mid');
  });

  it('描画解像度は端末の倍率と段階の上限の小さい方に、自動の倍率を掛ける', () => {
    expect(pixelRatioFor(QUALITY.presets.high, 3)).toBe(2);
    expect(pixelRatioFor(QUALITY.presets.mid, 2.75)).toBe(1.5);
    expect(pixelRatioFor(QUALITY.presets.low, 2)).toBe(1);
    expect(pixelRatioFor(QUALITY.presets.high, 1)).toBe(1);
    expect(pixelRatioFor(QUALITY.presets.mid, 2, 0.9)).toBeCloseTo(1.35);
  });

  it('自動の下限は 0.75 倍（Q-31）', () => {
    const s = QUALITY.auto.scaleSteps;
    expect(s[0]).toBe(1);
    expect(s[s.length - 1]).toBe(0.75);
  });
});

describe('AutoResolution', () => {
  it('速いフレームが続く間は下げない', () => {
    const a = new AutoResolution(auto);
    expect(feed(a, 16.7, 100)).toBe(0);
    expect(a.scale).toBe(1);
  });

  it('遅いフレームが続いたら 1 段ずつ下げ、下限で止まる', () => {
    const a = new AutoResolution(auto);
    expect(feed(a, 25, 10)).toBe(1);
    expect(a.scale).toBe(0.9);
    // 下げた直後の窓は捨てる
    expect(feed(a, 25, 10)).toBe(0);
    expect(feed(a, 25, 10)).toBe(1);
    expect(a.scale).toBe(0.75);
    expect(a.atFloor).toBe(true);
    expect(feed(a, 25, 100)).toBe(0);
    expect(a.scale).toBe(0.75);
  });

  it('たまに遅いフレームがあるだけ（割合が閾値未満）では下げない', () => {
    const a = new AutoResolution(auto);
    for (let i = 0; i < 100; i++) a.push(i % 3 === 0 ? 40 : 16.7);
    expect(a.scale).toBe(1);
  });

  it('reset で元の解像度に戻る', () => {
    const a = new AutoResolution(auto);
    feed(a, 25, 10);
    a.reset();
    expect(a.scale).toBe(1);
  });
});
