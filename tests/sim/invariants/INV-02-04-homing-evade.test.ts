// INV-02 追尾球は通常移動で避けられない / INV-03 球種と回避方向のじゃんけん / INV-04 ステップは無敵ではない
import { describe, expect, it } from 'vitest';
import { createRng, nextFloat } from '../../../src/sim/rng';
import type { PlayerInput } from '../../../src/sim/types';
import { giveBall, has, makeWorld, place, throwAndResolve } from '../helpers';

const HOMING_TYPES: Record<string, Partial<PlayerInput>> = {
  straight: {},
  curveLeft: { moveRight: -1 },
  curveRight: { moveRight: 1 },
  lob: { moveForward: -1 },
};

const FAST = { attack: 5, defense: 5, agility: 10 };

describe('INV-02 追尾球は通常移動では避けられない', () => {
  const patterns: Record<string, (t: number) => Partial<PlayerInput>> = {
    strafeRight: () => ({ moveRight: 1 }),
    strafeLeft: () => ({ moveRight: -1 }),
    back: () => ({ moveForward: -1 }),
    forward: () => ({ moveForward: 1 }),
    zigzag: (t) => ({ moveRight: Math.floor(t / 6) % 2 ? 1 : -1 }),
    diagonal: (t) => ({ moveRight: Math.floor(t / 10) % 2 ? 1 : -1, moveForward: -1 }),
  };
  for (const [type, dir] of Object.entries(HOMING_TYPES)) {
    for (const [name, pat] of Object.entries(patterns)) {
      it(`${type} × ${name}`, () => {
        const w = makeWorld({ stats: [{ attack: 5, defense: 5, agility: 5 }, FAST] });
        giveBall(w, 0);
        const ev = throwAndResolve(w, 0, dir, (t) => pat(t));
        expect(has(ev, 'hit', 1)).toBe(true);
      });
    }
  }
  it('ランダムな移動 200 本でも全て命中', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const types = Object.values(HOMING_TYPES);
      const dir = types[i % types.length]!;
      const w = makeWorld({ stats: [{ attack: 5, defense: 5, agility: 5 }, FAST], seed: i + 1 });
      place(w, 1, 1 + nextFloat(rng) * 10, (nextFloat(rng) - 0.5) * 8);
      giveBall(w, 0);
      const seq = Array.from({ length: 240 }, () => ({ moveRight: nextFloat(rng) * 2 - 1, moveForward: nextFloat(rng) * 2 - 1 }));
      const ev = throwAndResolve(w, 0, dir, (t) => seq[t]!);
      expect(has(ev, 'hit', 1)).toBe(true);
    }
  });
});

describe('INV-03 球種と回避方向', () => {
  const steps: Record<string, Partial<PlayerInput>> = {
    front: { moveForward: 1 },
    back: { moveForward: -1 },
    none: {},
    left: { moveRight: -1 },
    right: { moveRight: 1 },
  };
  // 期待値（GDD 4.1、ストレートは Q-29 回答で左右のみ）: none は後方扱い
  const expected: Record<string, string[]> = {
    straight: ['left', 'right'],
    curveLeft: ['front', 'back', 'none'],
    curveRight: ['front', 'back', 'none'],
    lob: ['left', 'right'],
  };
  for (const [type, dir] of Object.entries(HOMING_TYPES)) {
    for (const [stepName, stepInput] of Object.entries(steps)) {
      const shouldEvade = expected[type]!.includes(stepName);
      it(`${type} に ${stepName} ステップ → ${shouldEvade ? '追尾解除・回避' : '追尾継続・被弾'}`, () => {
        const w = makeWorld();
        giveBall(w, 0);
        // リリース直後（溜め8F + 数F）にステップ
        const stepAt = w.balance.throw.windupF + 4;
        const ev = throwAndResolve(w, 0, dir, (t) => (t === stepAt ? { ...stepInput, step: true } : {}));
        expect(has(ev, 'homingCancelled', 1)).toBe(shouldEvade);
        expect(has(ev, 'hit', 1)).toBe(!shouldEvade);
      });
    }
  }
  it('斜め45°ちょうどは両方向として扱う（Q-04）', () => {
    const w = makeWorld();
    giveBall(w, 0);
    const ev = throwAndResolve(w, 0, { moveForward: -1 }, (t) => (t === 12 ? { step: true, moveRight: 1, moveForward: 1 } : {}));
    expect(has(ev, 'homingCancelled', 1)).toBe(true);
  });
});

describe('INV-04 ステップは無敵ではない', () => {
  it('無効方向のステップ中に届いた球は当たる', () => {
    const w = makeWorld();
    giveBall(w, 0);
    let stepping = false;
    const ev = throwAndResolve(w, 0, { moveRight: -1 }, (t, world) => {
      if (world.players[1].action === 'step') stepping = true;
      // 到達の少し前に左ステップ（左右カーブには無効）
      return t === 28 ? { step: true, moveRight: -1 } : {};
    });
    expect(stepping).toBe(true);
    expect(has(ev, 'hit', 1)).toBe(true);
  });
  it('ステップはポイントを1消費し、0なら出せない', () => {
    const w = makeWorld();
    const p = w.players[1];
    p.stepPoints = 1;
    throwAndResolve(w, 0, {}, (t) => (t === 0 ? { step: true } : {}), 5);
    expect(p.stepPoints).toBe(0);
    expect(p.action).toBe('step');
    const w2 = makeWorld();
    w2.players[1].stepPoints = 0;
    throwAndResolve(w2, 0, {}, (t) => (t === 0 ? { step: true } : {}), 5);
    expect(w2.players[1].action).not.toBe('step');
  });
});
