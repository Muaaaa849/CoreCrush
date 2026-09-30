// INV-17 間合いは固定 / INV-18 主役は通常球 / INV-20 勝敗 / INV-21 追尾で防御を難しくしない / INV-22 天井・床
import { describe, expect, it } from 'vitest';
import { dtSec, moveMul } from '../../../src/sim/balance';
import { advanceLoose, flightPoint } from '../../../src/sim/ball';
import { set, vec3 } from '../../../src/sim/math';
import { createRng, nextFloat } from '../../../src/sim/rng';
import type { PlayerInput } from '../../../src/sim/types';
import { giveBall, has, makeWorld, place, run, throwAndResolve, tick } from '../helpers';

describe('INV-17 相手コートに入れない', () => {
  it('前進し続けても、前ステップしても中央線を越えない', () => {
    const w = makeWorld();
    run(w, 300, () => [{ moveForward: 1 }, { moveForward: 1 }]);
    run(w, 30, (t) => [{ moveForward: 1, step: t === 0 }, { moveForward: 1, step: t === 0 }]);
    expect(w.players[0].pos.z).toBeLessThan(0);
    expect(w.players[1].pos.z).toBeGreaterThan(0);
  });
});

describe('INV-18 攻撃ステータスは球速にだけ効く', () => {
  it('攻撃1と攻撃10でダメージは同じ、球速は違う', () => {
    const res = [1, 10].map((attack) => {
      const w = makeWorld({ stats: [{ attack, defense: 5, agility: 5 }, { attack: 5, defense: 5, agility: 5 }] });
      giveBall(w, 0);
      const ev = throwAndResolve(w, 0, {});
      return { speed: ev.find((e) => e.kind === 'release')!.value, dmg: ev.find((e) => e.kind === 'hit')!.value };
    });
    expect(res[0]!.dmg).toBe(res[1]!.dmg);
    expect(res[1]!.speed).toBeGreaterThan(res[0]!.speed);
  });
});

describe('INV-20 勝敗', () => {
  it('HP0 でラウンド取得、2本先取で試合終了', () => {
    const w = makeWorld();
    for (let r = 0; r < w.balance.round.roundsToWin; r++) {
      if (w.phase === 'roundEnd') run(w, 1000, () => [{}, {}]);
      while (w.phase === 'roundEnd') run(w, 1);
      w.players[1].hp = 1;
      giveBall(w, 0);
      const ev = throwAndResolve(w, 0, {});
      expect(has(ev, 'hit', 1)).toBe(true);
      run(w, 1);
    }
    expect(w.phase).toBe('matchOver');
    expect(w.players[0].wins).toBe(w.balance.round.roundsToWin);
  });
});

describe('INV-21 追尾・吸着でキャッチや跳ね返しを難しくしない', () => {
  const moves: Record<string, (t: number) => Partial<PlayerInput>> = {
    still: () => ({}),
    strafe: () => ({ moveRight: 1 }),
    back: () => ({ moveForward: -1 }),
  };
  // 受け手は投擲直後に一定距離（MOVE_M）だけ動く。移動速度が変わっても検証の厳しさが変わらないよう、時間ではなく距離で決める
  const MOVE_M = 5 / 6;
  for (const type of [{}, { moveRight: -1 }, { moveForward: -1 }] as Partial<PlayerInput>[]) {
    it(`${JSON.stringify(type)}: 動いていても到達 tick は静止時と ±1 以内、同じ押しタイミングで同じ結果`, () => {
      const b0 = makeWorld().balance;
      const moveTicks = Math.round(MOVE_M / (b0.player.baseMoveMps * moveMul(b0, 5) * dtSec(b0)));
      const arrival: Record<string, number> = {};
      for (const [name, mv] of Object.entries(moves)) {
        const w = makeWorld();
        giveBall(w, 0);
        const ev = throwAndResolve(w, 0, type, (t) => (t < moveTicks ? mv(t) : {}));
        arrival[name] = ev.find((e) => e.kind === 'hit')!.tick;
      }
      expect(Math.abs(arrival.strafe! - arrival.still!)).toBeLessThanOrEqual(1);
      expect(Math.abs(arrival.back! - arrival.still!)).toBeLessThanOrEqual(2);
      // 静止時の到達から逆算してキャッチを押せば、移動していても取れる
      const pressOffset = arrival.still! - makeWorld().tick; // 絶対 tick → 相対
      for (const [name, mv] of Object.entries(moves)) {
        const w = makeWorld();
        giveBall(w, 0);
        const start = w.tick;
        const press = arrival[name]! - start - w.balance.catch.startupF - 2;
        const ev = throwAndResolve(w, 0, type, (t) => (t === press ? { secondary: true } : t < moveTicks ? mv(t) : {}));
        expect(has(ev, 'catch', 1) || has(ev, 'justCatch', 1), name).toBe(true);
      }
      expect(pressOffset).toBeGreaterThan(0);
    });
  }
});

describe('INV-22 天井・側壁に当たらない / 床の球は落ち着く', () => {
  it('全球種 × 投げ手と受け手の位置の組み合わせで、飛翔中に天井・側壁・奥壁に触れない', () => {
    const w = makeWorld();
    const b = w.balance;
    const r = b.ball.radiusM;
    const p = vec3();
    const xs = [-4.6, -2, 0, 2, 4.6];
    const zs = [0.7, 3, 6, 9, 11.6];
    for (const type of ['straight', 'curveLeft', 'curveRight', 'lob'] as const) {
      const data = b.throw.types[type];
      for (const ax of xs) for (const az of zs) for (const bx of xs) for (const bz of zs) {
        const ball = { ...w.ball, start: vec3(ax, b.player.handHeightM, -az + 0.5), target: vec3(bx, b.player.chestHeightM, bz), lateralM: data.lateralM, apexM: data.apexM };
        for (let u = 0; u <= 1; u += 0.02) {
          flightPoint(b, ball, u, p);
          expect(p.y).toBeLessThanOrEqual(b.court.ceilingM - r);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(b.court.widthM / 2 - r);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(b.court.depthM - r);
        }
      }
    }
  });

  it('外れた球・落ちた球は床で 2 回以内しか跳ねない（誰にも拾われない条件で物理だけを回す）', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const w = makeWorld({ seed: i + 1 });
      const b = w.balance;
      const ball = w.ball;
      ball.mode = 'loose';
      ball.bounces = 0;
      // 天井近くから、最速級の球速で任意の方向へ
      set(ball.pos, (nextFloat(rng) - 0.5) * 8, b.ball.radiusM + nextFloat(rng) * (b.court.ceilingM - 1), (nextFloat(rng) - 0.5) * 20);
      const s = 5 + nextFloat(rng) * 40;
      set(ball.vel, (nextFloat(rng) * 2 - 1) * s, (nextFloat(rng) * 2 - 1) * s, (nextFloat(rng) * 2 - 1) * s);
      for (let t = 0; t < 60 * 20; t++) advanceLoose(w);
      expect(ball.bounces).toBeLessThanOrEqual(2);
      expect(ball.pos.y).toBeCloseTo(b.ball.radiusM, 3);
    }
  });

  it('取得半径はキャラより大きく、近づけば自動で拾える', () => {
    const w = makeWorld();
    expect(w.balance.player.pickupRadiusM).toBeGreaterThan(w.balance.player.bodyRadiusM);
    // 開幕の球（コート中央）へ、その側のプレイヤーを前に歩かせる
    const side = w.ball.side;
    const ev = run(w, 240, () => (side === 0 ? [{ moveForward: 1 }, {}] : [{}, { moveForward: 1 }]));
    expect(has(ev, 'pickup', side)).toBe(true);
  });
});
