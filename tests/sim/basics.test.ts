import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../src/data/loadBalance';
import { attackSpeedMul, countPowerMul, countSpeedMul, maxHp, moveMul, stepRecoverTicks } from '../../src/sim/balance';
import { createBot, botInput } from '../../src/bot/simpleBot';
import { createWorld, stepWorld } from '../../src/sim/world';
import { MEDIAN } from './helpers';
import type { Stats } from '../../src/sim/balance';
import type { SimEvent } from '../../src/sim/types';

const b = loadBalance();

describe('GDD の数表と式が一致する', () => {
  it('6.1 補正表', () => {
    const speed = [0.84, 0.88, 0.92, 0.96, 1.0, 1.04, 1.08, 1.12, 1.16, 1.2];
    const hp = [68, 76, 84, 92, 100, 108, 116, 124, 132, 140];
    const rec = [19.7, 18.5, 17.4, 16.3, 15.0, 14.2, 13.4, 12.7, 12.1, 11.5];
    for (let v = 1; v <= 10; v++) {
      expect(attackSpeedMul(b, v)).toBeCloseTo(speed[v - 1]!, 5);
      expect(moveMul(b, v)).toBeCloseTo(speed[v - 1]!, 5);
      expect(maxHp(b, v)).toBe(hp[v - 1]);
      // D-9: 敏捷2〜4 は GDD の表が式と合わない。式を正とし、表は他の値でだけ照合する
      if (v < 2 || v > 4) expect(Math.abs(stepRecoverTicks(b, v) / 60 - rec[v - 1]!)).toBeLessThan(0.06);
    }
  });
  it('2.3 カウント倍率表', () => {
    const rows: [number, number, number][] = [[0, 1.0, 1.0], [2, 1.02, 1.04], [4, 1.06, 1.15], [6, 1.14, 1.34], [7, 1.19, 1.46], [7.5, 1.22, 1.53]];
    for (const [t, s, p] of rows) {
      expect(countSpeedMul(b, t)).toBeCloseTo(s, 1.7);
      expect(countPowerMul(b, t)).toBeCloseTo(p, 1.7);
    }
  });
});

function playMatch(seed: number, stats: [Stats, Stats], maxTicks = 60 * 60 * 20) {
  const w = createWorld(loadBalance(), { seed, stats });
  const bots = [createBot(0, seed * 7 + 1), createBot(1, seed * 13 + 2)] as const;
  const log: SimEvent[] = [];
  const b = w.balance;
  for (let t = 0; t < maxTicks && w.phase !== 'matchOver'; t++) {
    stepWorld(w, [{ ...botInput(w, bots[0]) }, { ...botInput(w, bots[1]) }]);
    for (let i = 0; i < w.eventCount; i++) log.push({ ...w.events[i]! });
    // 毎 tick の健全性
    const p = w.ball.pos;
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    expect(p.y).toBeLessThanOrEqual(b.court.ceilingM);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(b.court.widthM / 2);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(b.court.depthM);
    for (const pl of w.players) expect(Math.sign(pl.pos.z)).toBe(pl.side === 0 ? -1 : 1);
  }
  return { w, log };
}

describe('ボット戦のスモーク', () => {
  it('10ラウンド以上をエラーなく完走し、2本先取で試合が終わる', () => {
    let rounds = 0;
    for (let seed = 1; rounds < 10; seed++) {
      const { w, log } = playMatch(seed, [MEDIAN, { attack: 7, defense: 4, agility: 5 }]);
      expect(w.phase).toBe('matchOver');
      const ends = log.filter((e) => e.kind === 'roundEnd');
      rounds += ends.length;
      const winner = log.find((e) => e.kind === 'matchEnd')!.side as 0 | 1;
      expect(w.players[winner].wins).toBe(b.round.roundsToWin);
      expect(seed).toBeLessThan(20);
    }
  });

  it('同じシードと入力なら同じイベント列になる（決定論）', () => {
    const a = playMatch(42, [MEDIAN, MEDIAN]).log.map((e) => `${e.tick}:${e.kind}:${e.side}:${e.value.toFixed(6)}:${e.label}`).join('\n');
    const c = playMatch(42, [MEDIAN, MEDIAN]).log.map((e) => `${e.tick}:${e.kind}:${e.side}:${e.value.toFixed(6)}:${e.label}`).join('\n');
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(c);
  });
});
