// 到達時の判定（受け手権威の判定点）。順序は「キャッチ → 跳ね返し → 被弾」（防御を先に。INV-21）
import { catchWindowF, justWindowF, countPowerMul, rallyDamageMul } from '../balance';
import { dropAt, launchFlight } from '../ball';
import { emit } from '../events';
import { throwTypeFromInput } from '../throwType';
import type { Player, World } from '../types';

export function catchWindowActive(w: World, p: Player): boolean {
  if (p.action !== 'catch') return false;
  const s = w.balance.catch.startupF;
  return p.actionTick >= s && p.actionTick < s + catchWindowF(w.balance, p.stats.defense, p.catchBonusF);
}

export function parryWindowActive(w: World, p: Player): boolean {
  if (p.action !== 'parry') return false;
  const s = w.balance.parry.startupF;
  return p.actionTick >= s && p.actionTick < s + w.balance.parry.windowF;
}

function addMeter(w: World, p: Player, v: number): void {
  p.meter = Math.min(w.balance.meter.max, p.meter + v);
}

export function setAction(p: Player, action: Player['action'], length: number): void {
  p.action = action;
  p.actionTick = 0;
  p.actionLength = length;
}

/** ボールが受け手の体に届いた */
export function resolveArrival(w: World): void {
  const b = w.balance;
  const ball = w.ball;
  const r = w.players[ball.receiver];

  if (catchWindowActive(w, r)) {
    const intoWindow = r.actionTick - b.catch.startupF;
    const just = intoWindow < justWindowF(b, r.stats.defense);
    ball.mode = 'held';
    ball.holder = r.side;
    r.holding = true;
    setAction(r, 'catchRecovery', b.catch.recoveryF);
    addMeter(w, r, b.catch.gain + (just ? b.catch.justBonusGain : 0));
    // OPEN: Q-25 普通のキャッチで「食らう」スキル効果は M4 で実装（ジャストなら無効）
    emit(w, just ? 'justCatch' : 'catch', r.side, intoWindow);
    return;
  }

  if (parryWindowActive(w, r)) {
    // 返球の球種は受け手の移動入力で選ぶ（狙い投げは不可）。速さは受けた球×rallySpeedMul（上限なし。Q-06, Q-26）
    const type = throwTypeFromInput(b, r.input, false);
    const speed = ball.speedMps * b.parry.rallySpeedMul;
    // OPEN: Q-14 返球の威力は返した時点のカウントで計算
    const power = countPowerMul(b, ball.countTicks / b.tickHz);
    setAction(r, 'parryRecovery', b.parry.recoveryF);
    addMeter(w, r, b.parry.gain);
    launchFlight(w, r, type, speed, power, b.throw.types[type], ball.rally + 1);
    emit(w, 'parry', r.side, speed, type);
    return;
  }

  // ラリーするほど当たったときの威力が上がる（リスクとリターンが一緒に上がる。プランナー 2026-10-01）
  // OPEN: Q-32 上げ幅（仮 0.15）・上限・爆発への適用は提案 0004 で確認待ち
  const dmg = b.throw.baseDamage * ball.powerMul * rallyDamageMul(b, ball.rally);
  r.hp -= dmg;
  setAction(r, 'hitReaction', b.hit.reactionF);
  dropAt(w, r);
  emit(w, 'hit', r.side, dmg, ball.kind);
}

