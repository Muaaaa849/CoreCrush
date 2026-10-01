// ボールの軌跡の色（プランナー 2026-10-01）: 球種で色分け、ラリーで濃くなる、最初は淡い
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { BALL_TRAIL, trailColor } from '../../src/vfx/ballTrail';

const c = (kind: Parameters<typeof trailColor>[1], rally: number) => trailColor(BALL_TRAIL, kind, rally, new THREE.Color());
/** 彩度の目安（最大 − 最小） */
const chroma = (x: THREE.Color) => Math.max(x.r, x.g, x.b) - Math.min(x.r, x.g, x.b);

describe('軌跡の色', () => {
  it('ストレート=赤、左右カーブ=黄、上カーブ=青（最も濃いとき）', () => {
    const n = BALL_TRAIL.rally.fullRally;
    const red = c('straight', n);
    expect(red.r).toBeGreaterThan(red.g);
    expect(red.r).toBeGreaterThan(red.b);
    for (const k of ['curveLeft', 'curveRight'] as const) {
      const y = c(k, n);
      expect(Math.min(y.r, y.g)).toBeGreaterThan(y.b * 2);
    }
    const blue = c('lob', n);
    expect(blue.b).toBeGreaterThan(blue.r);
    expect(blue.b).toBeGreaterThan(blue.g);
    // 狙い投げはストレートと同じ色
    expect(c('aimed', n).equals(red)).toBe(true);
  });

  it('ラリーごとに濃くなり、fullRally 以降は変わらない。投げた球（ラリー 0）は淡い', () => {
    const n = BALL_TRAIL.rally.fullRally;
    for (const k of ['straight', 'curveLeft', 'lob'] as const) {
      for (let r = 1; r <= n; r++) expect(chroma(c(k, r))).toBeGreaterThan(chroma(c(k, r - 1)));
      expect(c(k, n + 5).equals(c(k, n))).toBe(true);
      expect(chroma(c(k, 0))).toBeLessThan(chroma(c(k, n)) * 0.5);
    }
  });
});
