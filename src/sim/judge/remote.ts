// 通信対戦: 相手が判定した結果（確定イベント）と相手の状態を、この World に反映する（受け手権威。GDD 11.3）。
// net 層はここで定義した平たいデータを運ぶだけで、判定はしない。
import type { StepDir, ThrowTypeName } from '../balance';
import { chestOf } from '../ball';
import { emit } from '../events';
import { copy, set, vec3, type Vec3 } from '../math';
import type { Action, Ball, BallMode, SimEvent, SimEventKind, Side, World } from '../types';

/** 送る側が判定権を持って確定させるイベント */
export const AUTH_EVENT_KINDS = [
  'release', 'parry', 'catch', 'justCatch', 'hit', 'miss', 'explosion', 'pickup', 'handover', 'homingCancelled',
] as const satisfies readonly SimEventKind[];
export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number];

/** ボールの状態（確定イベントに同梱。値は送る側の tick 終了時点） */
export interface BallWire {
  mode: BallMode;
  holder: Side | -1;
  side: Side;
  pos: Vec3;
  vel: Vec3;
  countTicks: number;
  freezeTicks: number;
  thrower: Side;
  receiver: Side;
  kind: ThrowTypeName;
  speedMps: number;
  powerMul: number;
  start: Vec3;
  target: Vec3;
  lateralM: number;
  apexM: number;
  homing: boolean;
  evaded: boolean;
  evade: Record<StepDir, boolean>;
  rally: number;
  bounces: number;
}

export interface AuthEvent {
  /** 送る側ごとの連番（0 から） */
  seq: number;
  /** 送る側の tick（ログ用。受け手の時刻とは揃っていない） */
  tick: number;
  round: number;
  kind: AuthEventKind;
  side: Side | -1;
  value: number;
  /** 被弾・爆発の被害者の HP（それ以外は NaN） */
  hp: number;
  ballAuth: Side | -1;
  ball: BallWire;
}

/** 相手の状態（非信頼チャネルで毎 tick） */
export interface RemoteState {
  tick: number;
  round: number;
  x: number;
  z: number;
  action: Action;
  actionTick: number;
  actionLength: number;
  meter: number;
  stepPoints: number;
  /** 送る側が判定権を持つときのカウント（表示用）。-1 は無し */
  countTicks: number;
  freezeTicks: number;
}

export function createBallWire(): BallWire {
  return {
    mode: 'loose', holder: -1, side: 0, pos: vec3(), vel: vec3(), countTicks: 0, freezeTicks: 0,
    thrower: 0, receiver: 1, kind: 'straight', speedMps: 0, powerMul: 1, start: vec3(), target: vec3(),
    lateralM: 0, apexM: 0, homing: false, evaded: false, evade: { front: false, back: false, left: false, right: false },
    rally: 0, bounces: 0,
  };
}

/** 自分が判定権を持って確定させたイベントか（net 層はこれだけを送る） */
export function isAuthoritative(w: World, e: SimEvent): e is SimEvent & { kind: AuthEventKind } {
  if (w.local === -1) return false;
  switch (e.kind) {
    case 'explosion':
    case 'handover':
      return true; // 判定権を持つ側でしか起きない
    case 'miss':
      return e.side === w.local; // 自分に向かった球が外れた（相手に向かった球の miss は表示だけ）
    case 'release': case 'parry': case 'catch': case 'justCatch': case 'hit': case 'pickup': case 'homingCancelled':
      return e.side === w.local;
    default:
      return false;
  }
}

export function captureBall(w: World, out: BallWire): BallWire {
  const b = w.ball;
  out.mode = b.mode; out.holder = b.holder; out.side = b.side;
  copy(out.pos, b.pos); copy(out.vel, b.vel);
  out.countTicks = b.countTicks; out.freezeTicks = b.freezeTicks;
  out.thrower = b.thrower; out.receiver = b.receiver; out.kind = b.kind;
  out.speedMps = b.speedMps; out.powerMul = b.powerMul;
  copy(out.start, b.start); copy(out.target, b.target);
  out.lateralM = b.lateralM; out.apexM = b.apexM; out.homing = b.homing; out.evaded = b.evaded;
  out.evade.front = b.evade.front; out.evade.back = b.evade.back; out.evade.left = b.evade.left; out.evade.right = b.evade.right;
  out.rally = b.rally; out.bounces = b.bounces;
  return out;
}

function restoreBall(w: World, src: BallWire): void {
  const b: Ball = w.ball;
  b.mode = src.mode; b.holder = src.holder; b.side = src.side;
  copy(b.pos, src.pos); copy(b.prevPos, src.pos); copy(b.vel, src.vel);
  b.countTicks = src.countTicks; b.freezeTicks = src.freezeTicks;
  b.thrower = src.thrower; b.receiver = src.receiver; b.kind = src.kind;
  b.speedMps = src.speedMps; b.powerMul = src.powerMul;
  copy(b.start, src.start); copy(b.target, src.target);
  b.lateralM = src.lateralM; b.apexM = src.apexM; b.homing = src.homing; b.evaded = src.evaded;
  b.evade.front = src.evade.front; b.evade.back = src.evade.back; b.evade.left = src.evade.left; b.evade.right = src.evade.right;
  b.rally = src.rally; b.bounces = src.bounces;
  b.pending = false;
  for (const p of w.players) p.holding = b.mode === 'held' && b.holder === p.side;
}

/**
 * 相手の確定イベントを反映する。stepWorld の後に呼ぶ（この tick のイベントとして emit する）。
 * 投擲・跳ね返しは「発射点から再生」: u=0・発射点から飛ばし直し、飛翔時間を削らない（受け手の反応時間を縮めない）。
 */
export function applyAuthEvent(w: World, ev: AuthEvent): void {
  const ball = w.ball;
  if (ev.kind === 'homingCancelled') {
    // 表示中の飛翔を巻き戻さないよう、追尾の状態だけ反映する
    ball.homing = false;
    ball.evaded = true;
    copy(ball.target, ev.ball.target);
  } else {
    restoreBall(w, ev.ball);
    if ((ev.kind === 'release' || ev.kind === 'parry') && (ball.mode === 'flight' || ball.mode === 'linear')) {
      ball.u = 0;
      copy(ball.pos, ball.start);
      copy(ball.prevPos, ball.start);
      if (ball.mode === 'flight') chestOf(w.balance, w.players[ball.receiver], ball.target);
    }
    w.ballAuth = ev.ballAuth;
  }
  if ((ev.kind === 'hit' || ev.kind === 'explosion') && ev.side !== -1 && !Number.isNaN(ev.hp)) w.players[ev.side].hp = ev.hp;
  emit(w, ev.kind, ev.side, ev.value, ev.kind === 'release' || ev.kind === 'parry' ? ev.ball.kind : '');
}

/** 行動の表示名（フリと本物を区別しない。INV-23・netcode 規則） */
export function wireAction(a: Action): Action {
  if (a === 'fakeWindup') return 'windup';
  if (a === 'fakeRecovery') return 'throwRecovery';
  return a;
}

/** 相手の状態を反映する（位置・行動・ゲージ・ステップ。HP はイベントで確定させる） */
export function applyRemoteState(w: World, st: RemoteState): void {
  if (w.local === -1) return;
  const p = w.players[w.local === 0 ? 1 : 0];
  set(p.pos, st.x, 0, st.z);
  // 行動の開始（相手の時計）が変わったときだけ差し替える。同じ行動の間は手元で経過 tick を進める
  const start = st.tick - st.actionTick;
  if (p.action !== st.action || p.netActionStart !== start) {
    p.action = st.action;
    p.actionTick = st.actionTick;
    p.netActionStart = start;
  }
  p.actionLength = st.actionLength;
  p.meter = st.meter;
  p.stepPoints = st.stepPoints;
  if (st.countTicks >= 0 && w.ballAuth !== w.local) {
    w.ball.countTicks = st.countTicks;
    w.ball.freezeTicks = st.freezeTicks;
  }
}

export function captureState(w: World, out: RemoteState): RemoteState {
  const p = w.players[w.local === -1 ? 0 : w.local];
  out.tick = w.tick;
  out.round = w.round;
  out.x = p.pos.x;
  out.z = p.pos.z;
  out.action = wireAction(p.action);
  out.actionTick = p.actionTick;
  out.actionLength = p.actionLength;
  out.meter = p.meter;
  out.stepPoints = p.stepPoints;
  const auth = w.ballAuth === w.local;
  out.countTicks = auth ? w.ball.countTicks : -1;
  out.freezeTicks = auth ? w.ball.freezeTicks : 0;
  return out;
}
