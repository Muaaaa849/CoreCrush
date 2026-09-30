import { loadBalance, type DeepPartial } from '../../src/data/loadBalance';
import type { Balance, Stats } from '../../src/sim/balance';
import { handOf } from '../../src/sim/ball';
import { createWorld, stepWorld } from '../../src/sim/world';
import { NO_INPUT, type PlayerInput, type SimEvent, type Side, type World } from '../../src/sim/types';
import { set } from '../../src/sim/math';

export const MEDIAN: Stats = { attack: 5, defense: 5, agility: 5 };

export function makeWorld(opts: { balance?: DeepPartial<Balance>; stats?: [Stats, Stats]; seed?: number } = {}): World {
  const b = loadBalance(opts.balance);
  const w = createWorld(b, { seed: opts.seed ?? 1, stats: opts.stats ?? [MEDIAN, MEDIAN] });
  return w;
}

export function inp(p: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NO_INPUT, ...p };
}

/** 1 tick 進めて、その tick のイベントのコピーを返す */
export function tick(w: World, a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}): SimEvent[] {
  stepWorld(w, [inp(a), inp(b)]);
  return w.events.slice(0, w.eventCount).map((e) => ({ ...e }));
}

export function run(w: World, n: number, f?: (t: number) => [Partial<PlayerInput>?, Partial<PlayerInput>?]): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < n; t++) {
    const [a, b] = f ? f(t) : [];
    all.push(...tick(w, a ?? {}, b ?? {}));
  }
  return all;
}

/** カウントを止めずに side にボールを持たせる */
export function giveBall(w: World, side: Side): void {
  const p = w.players[side];
  const ball = w.ball;
  ball.mode = 'held';
  ball.holder = side;
  p.holding = true;
  ball.side = side;
  ball.countTicks = 0;
  ball.freezeTicks = 0;
  handOf(w.balance, p, ball.pos);
  w.ballAuth = side;
}

/** 中央線からの距離でプレイヤーを置く */
export function place(w: World, side: Side, fromCenter: number, x = 0): void {
  const p = w.players[side];
  set(p.pos, x, 0, side === 0 ? -fromCenter : fromCenter);
}

export const has = (events: SimEvent[], kind: SimEvent['kind'], side?: Side) =>
  events.some((e) => e.kind === kind && (side === undefined || e.side === side));

/** side が今すぐ throwDir で本投げし、決着（hit/catch/parry/miss）まで進める */
export function throwAndResolve(
  w: World,
  side: Side,
  dir: Partial<PlayerInput>,
  receiver: (t: number, w: World) => Partial<PlayerInput> = () => ({}),
  maxTicks = 240,
): SimEvent[] {
  const all: SimEvent[] = [];
  const thrower = (t: number): Partial<PlayerInput> => ({ ...dir, primary: t === 0 });
  for (let t = 0; t < maxTicks; t++) {
    const a = side === 0 ? thrower(t) : receiver(t, w);
    const b = side === 0 ? receiver(t, w) : thrower(t);
    const ev = tick(w, a, b);
    all.push(...ev);
    if (ev.some((e) => e.kind === 'hit' || e.kind === 'catch' || e.kind === 'justCatch' || e.kind === 'parry' || e.kind === 'miss')) break;
  }
  return all;
}
