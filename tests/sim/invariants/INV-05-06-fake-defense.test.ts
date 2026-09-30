// INV-05 フリは資源を使う読み合い / INV-06 キャッチは高リスク高リターン
import { describe, expect, it } from 'vitest';
import { catchWindowF, justWindowF } from '../../../src/sim/balance';
import { giveBall, has, makeWorld, run, throwAndResolve } from '../helpers';

describe('INV-05 フリ', () => {
  it('フリにはコストが要る（0 ではない）。ゲージ0ではフリできない', () => {
    const w0 = makeWorld();
    expect(w0.balance.fake.cost).toBeGreaterThan(0);
    giveBall(w0, 0);
    w0.players[0].meter = 0;
    expect(has(run(w0, 2, (t) => [t === 0 ? { fake: true } : {}]), 'fakeStart')).toBe(false);
  });

  it('コストが足りなければフリできない', () => {
    const w = makeWorld();
    giveBall(w, 0);
    w.players[0].meter = w.balance.fake.cost - 0.01;
    const ev = run(w, 2, (t) => [t === 0 ? { fake: true } : {}]);
    expect(has(ev, 'fakeStart')).toBe(false);
    expect(w.players[0].action).toBe('idle');
  });

  it('フリはコストを払い、本物と同じ溜めフレームを再生する', () => {
    const w = makeWorld();
    giveBall(w, 0);
    w.players[0].meter = 1;
    const timeline: string[] = [];
    run(w, w.balance.throw.windupF + 2, (t) => [t === 0 ? { fake: true } : {}]).forEach(() => undefined);
    expect(w.players[0].meter).toBeCloseTo(1 - w.balance.fake.cost);

    const real = makeWorld();
    giveBall(real, 0);
    const fake = makeWorld();
    giveBall(fake, 0);
    fake.players[0].meter = 1;
    for (let t = 0; t < real.balance.throw.windupF + 1; t++) {
      run(real, 1, () => [t === 0 ? { primary: true } : {}]);
      run(fake, 1, () => [t === 0 ? { fake: true } : {}]);
      // 相手から見える情報（行動の経過フレーム）は溜め終了まで同一
      timeline.push(`${real.players[0].actionTick}/${fake.players[0].actionTick}`);
      if (t < real.balance.throw.windupF - 1) expect(real.players[0].actionTick).toBe(fake.players[0].actionTick);
    }
  });

  it('フリ中の本投げはモーションを最初から再生する（必要フレームは短縮しない）', () => {
    const w = makeWorld();
    giveBall(w, 0);
    w.players[0].meter = 1;
    const clickAt = 5;
    let releaseAt = -1;
    for (let t = 0; t < 40 && releaseAt < 0; t++) {
      const ev = run(w, 1, () => [t === 0 ? { fake: true } : t === clickAt ? { primary: true } : {}]);
      if (has(ev, 'release', 0)) releaseAt = t;
    }
    expect(releaseAt - clickAt).toBe(w.balance.throw.windupF);
  });
});

describe('INV-06 キャッチと跳ね返しの関係', () => {
  const b = makeWorld().balance;
  // 2026-09-30 プランナー指示: キャッチ受付+2F。中央値の防御ではキャッチ < 跳ね返しを保つ。
  // 防御の高いキャラはキャッチが跳ね返しと並ぶ・超えるのを許容（防御キャラの特権。Q-28 の拡張）
  it('防御の中央値ではキャッチ受付 < 跳ね返し受付', () => {
    expect(catchWindowF(b, b.stats.median)).toBeLessThan(b.parry.windowF);
  });
  for (let d = 1; d <= 10; d++) {
    it(`防御${d}: ジャスト ≤ 受付、受付は防御とともに減らない`, () => {
      expect(justWindowF(b, d)).toBeLessThanOrEqual(catchWindowF(b, d));
      expect(justWindowF(b, d)).toBeGreaterThanOrEqual(1);
      if (d > 1) expect(catchWindowF(b, d)).toBeGreaterThanOrEqual(catchWindowF(b, d - 1));
    });
  }
  it('ジャスト幅は防御の中央値で 2F（Q-25）', () => {
    expect(justWindowF(b, b.stats.median)).toBe(2);
  });
  it('獲得コスト・空振り硬直はキャッチ > 跳ね返し', () => {
    expect(b.catch.gain).toBeGreaterThan(b.parry.gain);
    expect(b.catch.whiffStaggerF).toBeGreaterThan(b.parry.whiffStaggerF);
  });
  it('キャッチ成功でゲージが増え、ジャストなら上乗せ', () => {
    // 到達に合わせて押すタイミングを全探索し、普通のキャッチとジャストの両方が起きることを確認
    const gains = new Map<string, number>();
    for (let press = 0; press < 150; press++) {
      const w = makeWorld();
      giveBall(w, 0);
      const ev = throwAndResolve(w, 0, {}, (t) => (t === press ? { secondary: true } : {}));
      const k = has(ev, 'justCatch', 1) ? 'just' : has(ev, 'catch', 1) ? 'catch' : null;
      if (k) gains.set(k, w.players[1].meter);
    }
    expect(gains.get('catch')).toBeCloseTo(b.catch.gain);
    expect(gains.get('just')).toBeCloseTo(b.catch.gain + b.catch.justBonusGain);
  });
});
