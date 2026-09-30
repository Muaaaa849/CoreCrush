// INV-11 ラリーは加速し続け必ず決着する / INV-12 返した球は返した側のもの
import { describe, expect, it } from 'vitest';
import { botInput, createBot, ticksToArrival } from '../../../src/bot/simpleBot';
import type { PlayerInput, World } from '../../../src/sim/types';
import { giveBall, has, makeWorld, tick } from '../helpers';

/** 両者が完璧なタイミングで跳ね返し続ける */
function perfectParry(w: World, side: 0 | 1): Partial<PlayerInput> {
  const ball = w.ball;
  if (ball.mode !== 'flight' || ball.receiver !== side || w.players[side].action !== 'idle') return {};
  return ticksToArrival(w) <= w.balance.parry.startupF + 1 ? { primary: true } : {};
}

describe('INV-11 ラリー', () => {
  it('n 回目の返球速度は 初速×1.06^n（乗算・上限なし）で、いずれ返せなくなる', () => {
    const w = makeWorld();
    giveBall(w, 0);
    const speeds: number[] = [];
    let ended = false;
    for (let t = 0; t < 60 * 60 && !ended; t++) {
      const ev = tick(w, t === 0 ? { primary: true } : perfectParry(w, 0), perfectParry(w, 1));
      for (const e of ev) {
        if (e.kind === 'release' || e.kind === 'parry') speeds.push(e.value);
        if (e.kind === 'hit') ended = true;
      }
    }
    expect(ended).toBe(true);
    const v0 = speeds[0]!;
    speeds.forEach((v, n) => expect(v).toBeCloseTo(v0 * w.balance.parry.rallySpeedMul ** n, 6));
    // +40% を超えて加速した（上限なし。Q-26）
    expect(speeds[speeds.length - 1]!).toBeGreaterThan(v0 * 1.4);
  });

  it('非常に速い球でもすり抜けない（追尾球・狙い投げ）', () => {
    for (const aimed of [false, true]) {
      const w = makeWorld({ balance: { throw: { types: { straight: { speedMps: 800 }, aimed: { speedMps: 800 } } } } });
      giveBall(w, 0);
      let hit = false;
      for (let t = 0; t < 240 && !hit; t++) hit = has(tick(w, { primary: t === 0, secondaryHeld: aimed }), 'hit', 1);
      expect(hit).toBe(true);
    }
  });

  it('キャッチでラリーがリセットされる（次の投擲は基準速度）', () => {
    const w = makeWorld();
    giveBall(w, 0);
    const bot = createBot(1, 3, { holdMinTicks: 5, holdMaxTicks: 5, fakeChance: 0, catchChance: 0, parryChance: 1, stepChance: 0 });
    let first = 0;
    for (let t = 0; t < 30; t++) {
      const ev = tick(w, { primary: t === 0 }, botInput(w, bot));
      for (const e of ev) if (e.kind === 'release') first = e.value;
    }
    expect(first).toBeGreaterThan(0);
  });
});

describe('INV-12 返した球は返した側のもの', () => {
  it('返球は無入力でストレート（左右ステップで回避可）になり、投げ手が入れ替わる', () => {
    const w = makeWorld();
    giveBall(w, 0);
    for (let t = 0; t < 240; t++) {
      const ev = tick(w, { primary: t === 0 }, perfectParry(w, 1));
      if (has(ev, 'parry', 1)) break;
    }
    expect(w.ball.kind).toBe('straight');
    expect(w.ball.rally).toBe(1);
    expect(w.ball.thrower).toBe(1);
    expect(w.ball.receiver).toBe(0);
    expect(w.ball.homing).toBe(true);
    expect(w.ball.evade).toEqual({ front: false, back: false, left: true, right: true });
  });
  const returns: [string, Partial<PlayerInput>, string][] = [
    ['W', { moveForward: 1 }, 'straight'],
    ['A', { moveRight: -1 }, 'curveLeft'],
    ['D', { moveRight: 1 }, 'curveRight'],
    ['S', { moveForward: -1 }, 'lob'],
    ['右ボタン保持（狙い投げは不可）', { secondaryHeld: true }, 'straight'],
  ];
  for (const [name, move, kind] of returns) {
    it(`跳ね返しで ${name} → ${kind}（速さは受けた球×1.06、形は球種どおり）`, () => {
      const w = makeWorld();
      giveBall(w, 0);
      let incoming = 0;
      let returned = 0;
      for (let t = 0; t < 240 && !returned; t++) {
        const ev = tick(w, { primary: t === 0 }, { ...move, ...perfectParry(w, 1) });
        for (const e of ev) {
          if (e.kind === 'release') incoming = e.value;
          if (e.kind === 'parry') returned = e.value;
        }
      }
      expect(returned).toBeGreaterThan(0);
      expect(w.ball.kind).toBe(kind);
      expect(w.ball.mode).toBe('flight');
      expect(returned).toBeCloseTo(incoming * w.balance.parry.rallySpeedMul, 6);
      const data = w.balance.throw.types[kind as 'straight'];
      expect(w.ball.lateralM).toBe(data.lateralM);
    });
  }
  it('上カーブから始まったラリーは遅いまま（受けた球の速さ×1.06）', () => {
    const w = makeWorld();
    giveBall(w, 0);
    let lobSpeed = 0;
    let parrySpeed = 0;
    for (let t = 0; t < 120 && !parrySpeed; t++) {
      const ev = tick(w, { primary: t === 0, moveForward: -1 }, perfectParry(w, 1));
      for (const e of ev) {
        if (e.kind === 'release') lobSpeed = e.value;
        if (e.kind === 'parry') parrySpeed = e.value;
      }
    }
    expect(parrySpeed).toBeCloseTo(lobSpeed * w.balance.parry.rallySpeedMul, 6);
    expect(parrySpeed).toBeLessThan(w.balance.throw.types.straight.speedMps);
  });
});
