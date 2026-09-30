// タッチ操作の配置の読み込みと、スティックの出力（DOM 非依存の部分）
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOUCH_LAYOUT,
  EMPTY_CONTROLS,
  HOLDING_CONTROLS,
  SIZE_MAX,
  SIZE_MIN,
  TOUCH_CONTROL_IDS,
  parseLayout,
  stickVector,
} from '../../src/input/touchLayout';
import { throwTypeFromInput } from '../../src/sim/throwType';
import { loadBalance } from '../../src/data/loadBalance';
import { NO_INPUT } from '../../src/sim/types';

describe('parseLayout', () => {
  it('壊れた保存値は既定値になる', () => {
    for (const raw of [null, undefined, 42, 'x', []]) expect(parseLayout(raw)).toEqual(DEFAULT_TOUCH_LAYOUT);
  });

  it('足りない部品は既定値で埋め、範囲外は切り詰める', () => {
    const l = parseLayout({ opacity: 5, controls: { throw: { x: 2, y: -1, size: 99 }, aim: { x: 0.3 } } });
    expect(l.opacity).toBe(1);
    expect(l.controls.throw).toEqual({ x: 1, y: 0, size: SIZE_MAX });
    expect(l.controls.aim).toEqual({ ...DEFAULT_TOUCH_LAYOUT.controls.aim, x: 0.3 });
    expect(l.controls.stick).toEqual(DEFAULT_TOUCH_LAYOUT.controls.stick);
    expect(parseLayout({ controls: { step: { size: 0 } } }).controls.step.size).toBe(SIZE_MIN);
  });

  it('保存して読み直すと同じ配置になる', () => {
    const l = parseLayout(null);
    l.controls.catch = { x: 0.5, y: 0.5, size: 0.3 };
    l.stickFloating = true;
    l.lookDegPerPx = 0.4;
    expect(parseLayout(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });

  it('既定の配置はすべての部品を持ち、所持・非所持の両方にスティックとステップがある', () => {
    for (const id of TOUCH_CONTROL_IDS) expect(DEFAULT_TOUCH_LAYOUT.controls[id]).toBeDefined();
    for (const set of [HOLDING_CONTROLS, EMPTY_CONTROLS]) {
      expect(set).toContain('stick');
      expect(set).toContain('step');
    }
    expect(HOLDING_CONTROLS).toContain('throw');
    expect(EMPTY_CONTROLS).toEqual(expect.arrayContaining(['parry', 'catch']));
  });
});

describe('stickVector', () => {
  const v = { x: 0, y: 0 };
  it('デッドゾーン内は 0', () => {
    expect(stickVector(5, 5, 100, 0.15, v)).toEqual({ x: 0, y: 0 });
  });
  it('画面の上が前（+y）、右が +x', () => {
    stickVector(0, -100, 100, 0.15, v);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
    stickVector(100, 0, 100, 0.15, v);
    expect(v.x).toBeCloseTo(1);
  });
  it('半径の外は長さ 1 に切り詰める', () => {
    stickVector(300, 400, 100, 0.15, v);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });
  it('デッドゾーンの縁から 0 で立ち上がる', () => {
    stickVector(16, 0, 100, 0.15, v);
    expect(v.x).toBeGreaterThan(0);
    expect(v.x).toBeLessThan(0.02);
  });

  // スティックを倒しきったとき、キーボードと同じ球種になる（右・前が + の生の方向として sim に渡す）
  it('倒した方向で球種が決まる: 前・無入力＝ストレート / 左右＝カーブ / 後ろ＝上カーブ', () => {
    const b = loadBalance();
    const kind = (dx: number, dy: number) => {
      stickVector(dx, dy, 100, 0.15, v);
      return throwTypeFromInput(b, { ...NO_INPUT, keyRight: v.x, keyForward: v.y });
    };
    expect(kind(0, 0)).toBe('straight');
    expect(kind(0, -100)).toBe('straight');
    expect(kind(-100, 0)).toBe('curveLeft');
    expect(kind(100, 0)).toBe('curveRight');
    expect(kind(0, 100)).toBe('lob');
  });
});
