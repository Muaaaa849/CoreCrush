// テスト用のスクリプトボット（M1）。sim の状態を読み、PlayerInput だけを返す。
// 反応フレーム等の性格は BotProfile で与える（練習モード用ボットは Q-23 で別途判断）。
import { dtSec } from '../sim/balance';
import { flightDerivative } from '../sim/ball';
import { len, vec3 } from '../sim/math';
import { createRng, nextFloat, nextInt, type Rng } from '../sim/rng';
import type { PlayerInput, Side, World } from '../sim/types';

export interface BotProfile {
  /** 投げるまで待つ tick の範囲 */
  holdMinTicks: number;
  holdMaxTicks: number;
  fakeChance: number;
  catchChance: number;
  parryChance: number;
  stepChance: number;
}

export const DEFAULT_BOT: BotProfile = {
  holdMinTicks: 20,
  holdMaxTicks: 150,
  fakeChance: 0.25,
  catchChance: 0.4,
  parryChance: 0.35,
  stepChance: 0.15,
};

export interface Bot {
  side: Side;
  profile: BotProfile;
  rng: Rng;
  holdTimer: number;
  throwDir: { right: number; forward: number };
  defensePlan: 'none' | 'catch' | 'parry' | 'step' | 'take';
  plannedFor: number;
  input: PlayerInput;
}

export function createBot(side: Side, seed: number, profile: BotProfile = DEFAULT_BOT): Bot {
  return {
    side,
    profile,
    rng: createRng(seed),
    holdTimer: -1,
    throwDir: { right: 0, forward: 0 },
    defensePlan: 'none',
    plannedFor: -1,
    input: { moveRight: 0, moveForward: 0, primary: false, secondary: false, secondaryHeld: false, fake: false, step: false, aimDir: null },
  };
}

const tmp = vec3();

/** 飛翔中の球が受け手に届くまでの残り tick の見積もり */
export function ticksToArrival(w: World): number {
  const ball = w.ball;
  flightDerivative(w.balance, ball, ball.u, tmp);
  const remaining = (1 - ball.u) * len(tmp);
  return Math.ceil(remaining / (ball.speedMps * dtSec(w.balance)));
}

export function botInput(w: World, bot: Bot): PlayerInput {
  const b = w.balance;
  const me = w.players[bot.side];
  const ball = w.ball;
  const i = bot.input;
  i.primary = i.secondary = i.fake = i.step = i.secondaryHeld = false;
  i.moveRight = i.moveForward = 0;
  i.aimDir = null;

  if (me.holding) {
    if (bot.holdTimer < 0) {
      bot.holdTimer = bot.profile.holdMinTicks + nextInt(bot.rng, bot.profile.holdMaxTicks - bot.profile.holdMinTicks + 1);
      const k = nextInt(bot.rng, 4);
      bot.throwDir = k === 0 ? { right: 0, forward: 0 } : k === 1 ? { right: -1, forward: 0 } : k === 2 ? { right: 1, forward: 0 } : { right: 0, forward: -1 };
    }
    if (me.action === 'windup') {
      i.moveRight = bot.throwDir.right;
      i.moveForward = bot.throwDir.forward;
      return i;
    }
    if (me.action !== 'idle' && me.action !== 'fakeRecovery') return i;
    if (--bot.holdTimer <= 0) {
      bot.holdTimer = -1;
      if (me.action === 'idle' && me.meter >= b.fake.cost && nextFloat(bot.rng) < bot.profile.fakeChance) i.fake = true;
      else i.primary = true;
    }
    return i;
  }
  bot.holdTimer = -1;

  if ((ball.mode === 'flight' || ball.mode === 'linear') && ball.receiver === bot.side) {
    const flightId = ball.rally * 100000 + Math.floor(ball.speedMps * 10);
    if (bot.plannedFor !== flightId) {
      bot.plannedFor = flightId;
      const r = nextFloat(bot.rng);
      const p = bot.profile;
      bot.defensePlan = r < p.catchChance ? 'catch' : r < p.catchChance + p.parryChance ? 'parry' : r < p.catchChance + p.parryChance + p.stepChance ? 'step' : 'take';
    }
    if (ball.mode === 'flight' && me.action === 'idle') {
      const t = ticksToArrival(w);
      if (bot.defensePlan === 'catch' && t <= b.catch.startupF + 1) i.secondary = true;
      else if (bot.defensePlan === 'parry' && t <= b.parry.startupF + 2) i.primary = true;
      else if (bot.defensePlan === 'step' && t <= 10) {
        i.step = true;
        i.moveRight = nextFloat(bot.rng) < 0.5 ? -1 : 1;
      }
    }
    return i;
  }
  bot.plannedFor = -1;

  if (ball.mode === 'loose' && ball.side === bot.side) {
    // 自陣に落ちている球へ歩く（コート基準の入力に変換）
    const f = bot.side === 0 ? 1 : -1;
    const dx = ball.pos.x - me.pos.x;
    const dz = ball.pos.z - me.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    i.moveRight = -f * (dx / l);
    i.moveForward = f * (dz / l);
  }
  return i;
}
