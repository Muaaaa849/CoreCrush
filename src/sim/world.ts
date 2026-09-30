// sim の本体。固定 60Hz の tick で進む。three・DOM・時刻 API・Math.random に依存しない。
import {
  attackSpeedMul, countPowerMul, countSpeedMul, dtSec, maxHp, moveMul, secToTicks, stepRecoverTicks,
  type Balance, type Stats, type ThrowTypeName,
} from './balance';
import {
  advanceFlight, advanceLinear, advanceLoose, chestOf, handOf, launchFlight, launchLinear, other,
} from './ball';
import { classifyStep, clampToOwnCourt, courtCenter, courtToWorld, spawnPoint, stepDirsIntersect } from './court';
import { createEventBuffer, emit } from './events';
import { resolveArrival, setAction } from './judge/arrival';
import { updateCount } from './judge/count';
import { throwTypeFromInput } from './throwType';
import { copy, distXZ, set, vec3 } from './math';
import { createRng, nextInt } from './rng';
import { NO_INPUT, type Ball, type Player, type PlayerInput, type Side, type World } from './types';

export interface WorldOptions {
  seed: number;
  stats: [Stats, Stats];
  /** iron_grip 等のキャッチ受付加算（M4 でスキルから与える） */
  catchBonusF?: [number, number];
}

function createPlayer(b: Balance, side: Side, stats: Stats, catchBonusF: number): Player {
  return {
    side,
    stats,
    pos: vec3(),
    hp: maxHp(b, stats.defense),
    maxHp: maxHp(b, stats.defense),
    meter: 0,
    stepPoints: b.step.maxPoints,
    stepRecoverProgress: 0,
    action: 'idle',
    actionTick: 0,
    actionLength: 0,
    holding: false,
    catchBonusF,
    stepFrom: vec3(),
    stepTo: vec3(),
    stepDirs: { front: false, back: false, left: false, right: false },
    wins: 0,
    input: { ...NO_INPUT },
  };
}

function createBall(): Ball {
  return {
    mode: 'loose', holder: -1, pos: vec3(), prevPos: vec3(), vel: vec3(), side: 0,
    countTicks: 0, freezeTicks: 0,
    thrower: 0, receiver: 1, kind: 'straight', speedMps: 0, powerMul: 1,
    start: vec3(), target: vec3(), u: 0, lateralM: 0, apexM: 0, homing: false, evaded: false,
    evade: { front: false, back: false, left: false, right: false }, rally: 0, bounces: 0,
  };
}

export function createWorld(b: Balance, opts: WorldOptions): World {
  const bonus = opts.catchBonusF ?? [0, 0];
  const w: World = {
    balance: b,
    tick: 0,
    rng: createRng(opts.seed),
    phase: 'play',
    phaseTicks: 0,
    round: 0,
    players: [createPlayer(b, 0, opts.stats[0], bonus[0]), createPlayer(b, 1, opts.stats[1], bonus[1])],
    ball: createBall(),
    events: createEventBuffer(),
    eventCount: 0,
  };
  startRound(w);
  return w;
}

/** ラウンド開始: ボールはランダムな側のコート中央、一定時間カウントしない（2.1）。資源はリセット（Q-12 提案） */
export function startRound(w: World): void {
  const b = w.balance;
  w.round++;
  w.phase = 'play';
  for (const p of w.players) {
    spawnPoint(b, p.side, p.pos);
    p.hp = p.maxHp;
    p.meter = 0; // OPEN: Q-12
    p.stepPoints = b.step.maxPoints;
    p.stepRecoverProgress = 0;
    p.holding = false;
    setAction(p, 'idle', 0);
  }
  const ball = w.ball;
  const side: Side = nextInt(w.rng, 2) === 0 ? 0 : 1;
  ball.mode = 'loose';
  ball.holder = -1;
  courtCenter(b, side, ball.pos);
  copy(ball.prevPos, ball.pos);
  set(ball.vel, 0, 0, 0);
  ball.side = side;
  ball.countTicks = 0;
  ball.freezeTicks = secToTicks(b, b.count.roundStartFreezeSec);
  ball.rally = 0;
  ball.bounces = 0;
  emit(w, 'roundStart', side, w.round);
}

const tmp = vec3();
const tmp2 = vec3();

function release(w: World, p: Player): void {
  const b = w.balance;
  const type = throwTypeFromInput(b, p.input);
  const t = w.ball.countTicks / b.tickHz;
  const data = b.throw.types[type];
  const speed = data.speedMps * attackSpeedMul(b, p.stats.attack) * countSpeedMul(b, t);
  const power = countPowerMul(b, t);
  if (type === 'aimed') {
    let dir = p.input.aimDir;
    if (!dir) {
      // 狙いの指定がなければ相手の胸へ（ボット・テスト用）
      chestOf(b, w.players[other(p.side)], tmp);
      handOf(b, p, tmp2);
      dir = set(tmp, tmp.x - tmp2.x, tmp.y - tmp2.y, tmp.z - tmp2.z);
    }
    launchLinear(w, p, speed, power, dir);
  } else {
    launchFlight(w, p, type, speed, power, data, 0);
  }
  emit(w, 'release', p.side, speed, type);
}

function startStep(w: World, p: Player): boolean {
  const b = w.balance;
  if (p.stepPoints < 1) return false;
  p.stepPoints -= 1;
  classifyStep(b, p.input.moveRight, p.input.moveForward, p.stepDirs);
  const moving = Math.hypot(p.input.moveRight, p.input.moveForward) > 1e-6;
  courtToWorld(p.side, moving ? p.input.moveRight : 0, moving ? p.input.moveForward : -1, tmp);
  const l = Math.hypot(tmp.x, tmp.z) || 1;
  copy(p.stepFrom, p.pos);
  set(p.stepTo, p.pos.x + (tmp.x / l) * b.step.distanceM, 0, p.pos.z + (tmp.z / l) * b.step.distanceM);
  clampToOwnCourt(b, p.side, p.stepTo);
  setAction(p, 'step', b.step.durationF);
  emit(w, 'step', p.side);
  // 有効方向へのステップ開始で追尾解除（4.2）。無敵ではない（INV-04）
  const ball = w.ball;
  if (ball.mode === 'flight' && ball.receiver === p.side && ball.homing && stepDirsIntersect(ball.evade, p.stepDirs)) {
    ball.homing = false;
    ball.evaded = true; // Q-29 回答: 有効方向で追尾を切った球は当たらない（ストレートの有効方向は左右のみ）
    emit(w, 'homingCancelled', p.side);
  }
  return true;
}

/** 行動の時間経過と終了処理 */
function advanceAction(w: World, p: Player): void {
  const b = w.balance;
  p.actionTick++;
  switch (p.action) {
    case 'windup':
      if (p.actionTick >= b.throw.windupF) {
        if (p.holding) release(w, p);
        setAction(p, 'throwRecovery', b.throw.recoveryF);
      }
      return;
    case 'fakeWindup':
      if (p.actionTick >= b.throw.windupF) setAction(p, 'fakeRecovery', b.throw.recoveryF);
      return;
    case 'catch': {
      const end = b.catch.startupF + (b.catch.windowByDefenseF[p.stats.defense - 1] ?? 0) + p.catchBonusF;
      if (p.actionTick >= end) {
        setAction(p, 'stagger', b.catch.whiffStaggerF);
        emit(w, 'whiffCatch', p.side);
      }
      return;
    }
    case 'parry':
      if (p.actionTick >= b.parry.startupF + b.parry.windowF) {
        setAction(p, 'stagger', b.parry.whiffStaggerF);
        emit(w, 'whiffParry', p.side);
      }
      return;
    case 'step': {
      const k = Math.min(1, p.actionTick / b.step.durationF);
      const e = 1 - (1 - k) * (1 - k); // 出だしが速いイーズアウト
      set(p.pos, p.stepFrom.x + (p.stepTo.x - p.stepFrom.x) * e, 0, p.stepFrom.z + (p.stepTo.z - p.stepFrom.z) * e);
      if (p.actionTick >= p.actionLength) setAction(p, 'idle', 0);
      return;
    }
    default:
      if (p.actionLength > 0 && p.actionTick >= p.actionLength) setAction(p, 'idle', 0);
  }
}

/** 入力による新しい行動の開始 */
function handleInput(w: World, p: Player, input: PlayerInput): void {
  const b = w.balance;
  const a = p.action;
  const free = a === 'idle';
  const canStep = free || a === 'windup' || a === 'fakeWindup' || a === 'fakeRecovery' || a === 'throwRecovery' || a === 'stagger';
  if (input.step && canStep && startStep(w, p)) return;

  if (p.holding) {
    // フリ中の左クリックは本投げ。モーションは最初から（4.3）
    if (input.primary && (free || a === 'fakeWindup' || a === 'fakeRecovery')) {
      setAction(p, 'windup', 0);
      return;
    }
    if (input.fake && free && p.meter >= b.fake.cost) {
      p.meter -= b.fake.cost;
      setAction(p, 'fakeWindup', 0);
      emit(w, 'fakeStart', p.side);
    }
    return;
  }
  if (!free) return;
  if (input.secondary) setAction(p, 'catch', 0);
  else if (input.primary) setAction(p, 'parry', 0);
}

function move(w: World, p: Player, input: PlayerInput): void {
  const b = w.balance;
  const a = p.action;
  let mul: number;
  if (a === 'idle' || a === 'throwRecovery' || a === 'fakeRecovery') mul = 1;
  else if (a === 'windup' || a === 'fakeWindup') mul = b.player.moveMulDuringWindup;
  else return;
  const mag = Math.hypot(input.moveRight, input.moveForward);
  if (mag < 1e-6) return;
  const s = Math.min(1, mag);
  courtToWorld(p.side, input.moveRight / mag, input.moveForward / mag, tmp);
  const d = b.player.baseMoveMps * moveMul(b, p.stats.agility) * mul * s * dtSec(b);
  p.pos.x += tmp.x * d;
  p.pos.z += tmp.z * d;
  clampToOwnCourt(b, p.side, p.pos);
}

function tryPickup(w: World, p: Player): void {
  const b = w.balance;
  const ball = w.ball;
  if (ball.mode !== 'loose' || p.holding) return;
  if (ball.side !== p.side) return;
  const a = p.action;
  if (!(a === 'idle' || a === 'step' || a === 'throwRecovery' || a === 'fakeRecovery')) return;
  if (ball.pos.y > b.player.pickupMaxHeightM) return;
  if (distXZ(ball.pos, p.pos) > b.player.pickupRadiusM) return;
  ball.mode = 'held';
  ball.holder = p.side;
  p.holding = true;
  emit(w, 'pickup', p.side);
}

function recoverSteps(w: World): void {
  const b = w.balance;
  for (const p of w.players) {
    if (p.stepPoints >= b.step.maxPoints) {
      p.stepRecoverProgress = 0;
      continue;
    }
    // ボールが相手コートにある間だけ進む（6.3, INV-09）
    if (w.ball.side === p.side) continue;
    p.stepRecoverProgress++;
    if (p.stepRecoverProgress >= stepRecoverTicks(b, p.stats.agility)) {
      p.stepPoints++;
      p.stepRecoverProgress = 0;
    }
  }
}

function updateBall(w: World): void {
  const b = w.balance;
  const ball = w.ball;
  switch (ball.mode) {
    case 'held': {
      const h = w.players[ball.holder === -1 ? 0 : ball.holder];
      copy(ball.prevPos, ball.pos);
      handOf(b, h, ball.pos);
      return;
    }
    case 'flight': {
      const r = advanceFlight(w);
      if (r === 'contact') resolveArrival(w);
      else if (r === 'miss') emit(w, 'miss', ball.receiver);
      return;
    }
    case 'linear': {
      const r = advanceLinear(w);
      if (r === 'contact') resolveArrival(w);
      else if (r === 'miss') emit(w, 'miss', ball.receiver);
      return;
    }
    case 'loose':
      advanceLoose(w);
  }
}

function checkKo(w: World): void {
  const [p0, p1] = w.players;
  const ko0 = p0.hp <= 0;
  const ko1 = p1.hp <= 0;
  if (!ko0 && !ko1) return;
  const winner: Side | -1 = ko0 && ko1 ? -1 : ko0 ? 1 : 0;
  if (winner !== -1) w.players[winner].wins++;
  emit(w, 'roundEnd', winner, w.round);
  if (winner !== -1 && w.players[winner].wins >= w.balance.round.roundsToWin) {
    w.phase = 'matchOver';
    emit(w, 'matchEnd', winner);
    return;
  }
  w.phase = 'roundEnd';
  w.phaseTicks = secToTicks(w.balance, w.balance.round.interRoundSec);
}

function copyInput(dst: PlayerInput, src: PlayerInput): void {
  dst.moveRight = src.moveRight;
  dst.moveForward = src.moveForward;
  dst.primary = src.primary;
  dst.secondary = src.secondary;
  dst.secondaryHeld = src.secondaryHeld;
  dst.fake = src.fake;
  dst.step = src.step;
  dst.aimDir = src.aimDir;
  dst.keyRight = src.keyRight;
  dst.keyForward = src.keyForward;
}

/** 1 tick 進める */
export function stepWorld(w: World, inputs: readonly [PlayerInput, PlayerInput]): void {
  w.eventCount = 0;
  w.tick++;
  if (w.phase === 'matchOver') return;
  if (w.phase === 'roundEnd') {
    if (--w.phaseTicks <= 0) startRound(w);
    return;
  }
  for (const p of w.players) {
    copyInput(p.input, inputs[p.side]);
    advanceAction(w, p);
    handleInput(w, p, p.input);
    move(w, p, p.input);
  }
  updateBall(w);
  updateCount(w);
  recoverSteps(w);
  for (const p of w.players) tryPickup(w, p);
  // 所持中はボールの位置を手元に合わせる
  if (w.ball.mode === 'held' && w.ball.holder !== -1) handOf(w.balance, w.players[w.ball.holder], w.ball.pos);
  checkKo(w);
}
