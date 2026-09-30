// 8秒カウントと爆発（INV-07, INV-10）。ボールがあるコートの側で判定する。
import { secToTicks } from '../balance';
import { courtCenter } from '../court';
import { copy, set } from '../math';
import { currentSide, other } from '../ball';
import { hasBallAuthority } from '../authority';
import { emit } from '../events';
import { setAction } from './arrival';
import type { World } from '../types';

export function updateCount(w: World): void {
  const b = w.balance;
  const ball = w.ball;
  const side = currentSide(ball, w.players);
  if (side !== ball.side) {
    // 中央線（フェンス）を越えた瞬間に 0 から
    ball.side = side;
    ball.countTicks = 0;
    emit(w, 'cross', side);
    return;
  }
  if (ball.freezeTicks > 0) {
    ball.freezeTicks--;
    return;
  }
  const limit = secToTicks(b, b.count.explodeSec);
  // 通信対戦で判定権がないときは表示用に数えるだけ（爆発は判定権を持つ側のイベントで確定）
  if (!hasBallAuthority(w)) {
    ball.countTicks = Math.min(ball.countTicks + 1, limit - 1);
    return;
  }
  ball.countTicks++;
  if (ball.countTicks >= limit) explode(w);
}

export function explode(w: World): void {
  const b = w.balance;
  const ball = w.ball;
  const victim = w.players[ball.side];
  victim.hp -= b.count.explosionDamage;
  if (victim.holding) victim.holding = false;
  if (victim.action === 'windup' || victim.action === 'fakeWindup') setAction(victim, 'idle', 0);
  emit(w, 'explosion', victim.side, b.count.explosionDamage);
  // 新しいボールは相手コートに出現し、出現直後はカウントを止める（決定#5）
  const next = other(victim.side);
  ball.mode = 'loose';
  ball.holder = -1;
  courtCenter(b, next, ball.pos);
  copy(ball.prevPos, ball.pos);
  set(ball.vel, 0, 0, 0);
  ball.bounces = 0;
  ball.side = next;
  ball.countTicks = 0;
  ball.freezeTicks = secToTicks(b, b.count.postExplosionFreezeSec);
  ball.rally = 0;
  ball.pending = false;
  w.ballAuth = next;
}
