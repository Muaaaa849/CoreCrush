// INV-01 フリ→ストレートが刺さる（見てから）。攻撃5・カウント0・受け手が前半分（距離13m以内）
import { describe, expect, it } from 'vitest';
import type { DeepPartial } from '../../../src/data/loadBalance';
import type { Balance } from '../../../src/sim/balance';
import type { PlayerInput, World } from '../../../src/sim/types';
import { giveBall, has, makeWorld, place, tick } from '../helpers';

type Defense = 'none' | 'catch' | 'parry' | 'step';

/**
 * A(0) がフリ → B(1) がフリのリリースに合わせてキャッチを押して空振り →
 * A は空振りを見て R+N フレーム後に本投げ（ストレート）→ B は硬直明けに defense を最速で試みる。
 */
function scenario(defense: Defense, pressAt: number, balance?: DeepPartial<Balance>): { hit: boolean; w: World } {
  const w = makeWorld({ balance });
  const b = w.balance;
  place(w, 0, b.court.spawnFromCenterM);
  place(w, 1, b.invariants.fakeGuaranteeDistanceM - b.court.spawnFromCenterM);
  giveBall(w, 0);
  w.players[0].meter = 1;
  let whiffAt = -1;
  let throwAt = -1;
  const reaction = b.invariants.fakeReactionBudgetF + b.invariants.fakeNetBudgetF;
  for (let t = 0; t < 400; t++) {
    const a: Partial<PlayerInput> = {};
    const d: Partial<PlayerInput> = {};
    if (t === 0) a.fake = true;
    // フリのリリース（溜め終わり）に合わせてキャッチを押す＝空振り
    if (t === b.throw.windupF) d.secondary = true;
    if (whiffAt >= 0 && t === whiffAt + reaction) {
      a.primary = true;
      throwAt = t;
    }
    if (throwAt >= 0 && t === pressAt) {
      if (defense === 'catch') d.secondary = true;
      if (defense === 'parry') d.primary = true;
      if (defense === 'step') {
        d.step = true;
        d.moveRight = 1;
      }
    }
    const ev = tick(w, a, d);
    if (has(ev, 'whiffCatch', 1)) whiffAt = t;
    if (has(ev, 'hit', 1)) return { hit: true, w };
    if (has(ev, 'catch', 1) || has(ev, 'justCatch', 1) || has(ev, 'parry', 1) || has(ev, 'miss', 1)) return { hit: false, w };
  }
  throw new Error('決着しなかった');
}

/** 硬直明け以降のどの tick にどの防御を入れても被弾するか */
function guaranteed(balance?: DeepPartial<Balance>): boolean {
  for (const d of ['catch', 'parry'] as const) {
    for (let pressAt = 0; pressAt < 200; pressAt++) {
      if (!scenario(d, pressAt, balance).hit) return false;
    }
  }
  return true;
}

describe('INV-01 フリ→ストレート', () => {
  it('何もしなければ被弾する', () => {
    expect(scenario('none', -1).hit).toBe(true);
  });

  it('硬直明けにキャッチ・跳ね返しをどのタイミングで入れても間に合わない', () => {
    expect(guaranteed()).toBe(true);
  });

  it('空振り硬直はステップで抜けられ、回避できる（Q-02）', () => {
    // 本投げ直後にステップ（硬直中）
    const w = makeWorld();
    const r = (() => {
      for (let p = 0; p < 200; p++) {
        const s = scenario('step', p);
        if (!s.hit) return true;
      }
      return false;
    })();
    expect(w.balance.catch.whiffStaggerF).toBeGreaterThan(0);
    expect(r).toBe(true);
  });

  it('感度: 空振り硬直を GDD 初期値の 40F に戻すと成立しなくなる', () => {
    expect(guaranteed({ catch: { whiffStaggerF: 40 } })).toBe(false);
  });

  it('感度: 反応の余裕を 20F に増やすと成立しなくなる', () => {
    expect(guaranteed({ invariants: { fakeReactionBudgetF: 20 } })).toBe(false);
  });
});
