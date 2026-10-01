// 画面揺れ（GDD 3.2: 最大 0.15 秒・小振幅、設定の強度を必ず掛ける）
import { describe, expect, it } from 'vitest';
import { SCREEN_SHAKE, ScreenShake } from '../../src/render/screenShake';

const peak = (s: ScreenShake, t0: number) => {
  let m = 0;
  for (let t = t0; t < t0 + 0.3; t += 1 / 240) {
    const o = s.sample(t);
    m = Math.max(m, Math.abs(o.right), Math.abs(o.up));
  }
  return m;
};

describe('画面揺れ', () => {
  it('0.15 秒以内に止まり、振幅はプリセット以下', () => {
    const s = new ScreenShake();
    s.strength = 1;
    s.trigger('hit', 10);
    expect(peak(s, 10)).toBeGreaterThan(0);
    expect(peak(s, 10)).toBeLessThanOrEqual(SCREEN_SHAKE.presets.hit.amplitudeM);
    const o = s.sample(10 + 0.15);
    expect([o.right, o.up, o.roll]).toEqual([0, 0, 0]);
  });
  it('強度 0% なら揺れない、50% なら半分', () => {
    const s = new ScreenShake();
    s.strength = 0;
    s.trigger('hit', 0);
    expect(peak(s, 0)).toBe(0);
    const a = new ScreenShake();
    a.strength = 1;
    a.trigger('hit', 0);
    const b = new ScreenShake();
    b.strength = 0.5;
    b.trigger('hit', 0);
    expect(peak(b, 0)).toBeCloseTo(peak(a, 0) * 0.5, 6);
  });
});
