// INV-07 8秒カウント / INV-08 溜めるほど強い / INV-09 ステップ回復 / INV-10 開幕と爆発後
import { describe, expect, it } from 'vitest';
import { countPowerMul, countSpeedMul, secToTicks, stepRecoverTicks } from '../../../src/sim/balance';
import { giveBall, has, makeWorld, run, throwAndResolve } from '../helpers';

describe('INV-07 8秒カウントは逃げられない', () => {
  it('持ったままでも 8.0 秒で爆発し、自陣側が固定ダメージ', () => {
    const w = makeWorld();
    giveBall(w, 0);
    const n = secToTicks(w.balance, w.balance.count.explodeSec);
    const before = run(w, n - 1);
    expect(has(before, 'explosion')).toBe(false);
    const ev = run(w, 1);
    expect(has(ev, 'explosion', 0)).toBe(true);
    expect(w.players[0].hp).toBe(w.players[0].maxHp - w.balance.count.explosionDamage);
    expect(w.players[0].holding).toBe(false);
  });

  it('中央線を越えた瞬間に 0 から数え直す', () => {
    const w = makeWorld();
    giveBall(w, 0);
    run(w, 300);
    expect(w.ball.countTicks).toBe(300);
    const ev = throwAndResolve(w, 0, {});
    expect(has(ev, 'cross', 1)).toBe(true);
    expect(w.ball.countTicks).toBeLessThan(40);
  });
});

describe('INV-08 溜めるほど強く、終盤ほど急に伸びる', () => {
  const b = makeWorld().balance;
  it('t=0 で 1.0、単調増加かつ凸', () => {
    expect(countSpeedMul(b, 0)).toBe(1);
    expect(countPowerMul(b, 0)).toBe(1);
    for (const f of [countSpeedMul, countPowerMul]) {
      let prev = f(b, 0);
      let prevDelta = 0;
      for (let t = 0.5; t <= b.count.explodeSec; t += 0.5) {
        const v = f(b, t);
        expect(v).toBeGreaterThan(prev);
        expect(v - prev).toBeGreaterThanOrEqual(prevDelta);
        prevDelta = v - prev;
        prev = v;
      }
    }
  });
  it('カウント6秒で投げた球は0秒より速く重い', () => {
    const w0 = makeWorld();
    giveBall(w0, 0);
    const e0 = throwAndResolve(w0, 0, {});
    const w6 = makeWorld();
    giveBall(w6, 0);
    run(w6, 360);
    const e6 = throwAndResolve(w6, 0, {});
    const rel = (e: typeof e0) => e.find((x) => x.kind === 'release')!.value;
    const dmg = (e: typeof e0) => e.find((x) => x.kind === 'hit')!.value;
    expect(rel(e6)).toBeGreaterThan(rel(e0));
    expect(dmg(e6)).toBeGreaterThan(dmg(e0));
  });
});

describe('INV-09 ステップ回復はボールが相手コートにある間だけ', () => {
  it('自陣にある間は進まず、相手コートにある間だけ進む', () => {
    const w = makeWorld();
    const p = w.players[1];
    p.stepPoints = 0;
    giveBall(w, 1);
    run(w, 200);
    expect(p.stepRecoverProgress).toBe(0);
    giveBall(w, 0);
    w.ball.freezeTicks = 1e9; // 回復に要する時間より先に爆発しないよう、カウントを止めて測る
    const need = stepRecoverTicks(w.balance, p.stats.agility);
    run(w, need);
    expect(p.stepPoints).toBe(1);
  });
});

describe('INV-10 開幕と爆発後', () => {
  it('ラウンド開始から一定時間はカウントしない', () => {
    const w = makeWorld();
    const freeze = secToTicks(w.balance, w.balance.count.roundStartFreezeSec);
    expect(freeze).toBeGreaterThan(0);
    run(w, freeze);
    expect(w.ball.countTicks).toBe(0);
    run(w, 10);
    expect(w.ball.countTicks).toBe(10);
  });
  it('爆発後の新球は被害側から見て相手コートに出て、しばらくカウントしない', () => {
    const w = makeWorld();
    giveBall(w, 0);
    run(w, secToTicks(w.balance, w.balance.count.explodeSec));
    expect(w.ball.side).toBe(1);
    expect(w.ball.mode).toBe('loose');
    const freeze = secToTicks(w.balance, w.balance.count.postExplosionFreezeSec);
    expect(freeze).toBeGreaterThan(0);
    // 相手（side 1）は新球の真上にいないので拾わない。カウントは止まったまま
    run(w, freeze);
    expect(w.ball.countTicks).toBe(0);
  });
  it('開幕の球の出る側はシードで決まり、両側とも起こる', () => {
    const sides = new Set<number>();
    for (let s = 1; s <= 20; s++) sides.add(makeWorld({ seed: s }).ball.side);
    expect(sides.size).toBe(2);
  });
});
