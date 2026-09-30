// DataChannel のメッセージ（バイナリ・固定レイアウト、リトルエンディアン）。スキーマを変えたら PROTOCOL_VERSION を上げる。
// - state（非信頼）: 自分の状態。直近 STATE_REDUNDANCY 件を冗長同梱（GDD 11.2）
// - event（信頼）: 判定権を持つ側が確定させたイベント＋その時点のボール状態
import type { ThrowTypeName } from '../sim/balance';
import { AUTH_EVENT_KINDS, createBallWire, type AuthEvent, type AuthEventKind, type RemoteState } from '../sim/judge/remote';
import type { Action, BallMode, Side } from '../sim/types';

export const PROTOCOL_VERSION = 1;
export const STATE_REDUNDANCY = 4;
const MSG_STATE = 1;
const MSG_EVENT = 2;

const ACTIONS: readonly Action[] = [
  'idle', 'windup', 'fakeWindup', 'throwRecovery', 'fakeRecovery', 'catch', 'catchRecovery',
  'parry', 'parryRecovery', 'stagger', 'step', 'hitReaction',
];
const MODES: readonly BallMode[] = ['held', 'flight', 'linear', 'loose'];
const THROW_TYPES: readonly ThrowTypeName[] = ['straight', 'curveLeft', 'curveRight', 'lob', 'aimed'];

const STATE_ENTRY_BYTES = 4 + 2 + 4 + 4 + 1 + 2 + 2 + 4 + 1 + 4 + 2;
const STATE_HEADER_BYTES = 3;
const EVENT_BYTES = 2 + 4 + 4 + 2 + 1 + 1 + 8 + 8 + 1 + (1 + 1 + 1 + 8 * 3 + 8 * 3 + 2 + 2 + 1 + 1 + 1 + 8 + 8 + 8 * 3 + 8 * 3 + 8 + 8 + 1 + 2 + 1);

function idx<T>(list: readonly T[], v: T): number {
  const i = list.indexOf(v);
  if (i < 0) throw new Error(`protocol: unknown value ${String(v)}`);
  return i;
}
function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`protocol: bad index ${i}`);
  return v;
}
const side = (v: number): Side | -1 => (v === 0 ? 0 : v === 1 ? 1 : -1);

export type Decoded = { type: 'state'; states: RemoteState[] } | { type: 'event'; event: AuthEvent };

/** states は新しい順に最大 STATE_REDUNDANCY 件 */
export function encodeState(states: readonly RemoteState[]): ArrayBuffer {
  const n = Math.min(states.length, STATE_REDUNDANCY);
  const buf = new ArrayBuffer(STATE_HEADER_BYTES + n * STATE_ENTRY_BYTES);
  const d = new DataView(buf);
  d.setUint8(0, PROTOCOL_VERSION);
  d.setUint8(1, MSG_STATE);
  d.setUint8(2, n);
  let o = STATE_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const s = states[i]!;
    d.setUint32(o, s.tick, true); o += 4;
    d.setUint16(o, s.round, true); o += 2;
    d.setFloat32(o, s.x, true); o += 4;
    d.setFloat32(o, s.z, true); o += 4;
    d.setUint8(o, idx(ACTIONS, s.action)); o += 1;
    d.setUint16(o, Math.min(s.actionTick, 0xffff), true); o += 2;
    d.setUint16(o, Math.min(s.actionLength, 0xffff), true); o += 2;
    d.setFloat32(o, s.meter, true); o += 4;
    d.setUint8(o, s.stepPoints); o += 1;
    d.setInt32(o, s.countTicks, true); o += 4;
    d.setUint16(o, Math.min(s.freezeTicks, 0xffff), true); o += 2;
  }
  return buf;
}

export function encodeEvent(e: AuthEvent): ArrayBuffer {
  const buf = new ArrayBuffer(EVENT_BYTES);
  const d = new DataView(buf);
  let o = 0;
  const u8 = (v: number) => { d.setUint8(o, v); o += 1; };
  const i8 = (v: number) => { d.setInt8(o, v); o += 1; };
  const u16 = (v: number) => { d.setUint16(o, v, true); o += 2; };
  const u32 = (v: number) => { d.setUint32(o, v, true); o += 4; };
  const f64 = (v: number) => { d.setFloat64(o, v, true); o += 8; };
  u8(PROTOCOL_VERSION); u8(MSG_EVENT);
  u32(e.seq); u32(e.tick); u16(e.round);
  u8(idx(AUTH_EVENT_KINDS, e.kind)); i8(e.side);
  f64(e.value); f64(e.hp); i8(e.ballAuth);
  const b = e.ball;
  u8(idx(MODES, b.mode)); i8(b.holder); u8(b.side);
  f64(b.pos.x); f64(b.pos.y); f64(b.pos.z);
  f64(b.vel.x); f64(b.vel.y); f64(b.vel.z);
  u16(b.countTicks); u16(b.freezeTicks);
  u8(b.thrower); u8(b.receiver); u8(idx(THROW_TYPES, b.kind));
  f64(b.speedMps); f64(b.powerMul);
  f64(b.start.x); f64(b.start.y); f64(b.start.z);
  f64(b.target.x); f64(b.target.y); f64(b.target.z);
  f64(b.lateralM); f64(b.apexM);
  u8((b.homing ? 1 : 0) | (b.evaded ? 2 : 0) | (b.evade.front ? 4 : 0) | (b.evade.back ? 8 : 0) | (b.evade.left ? 16 : 0) | (b.evade.right ? 32 : 0));
  u16(b.rally); u8(Math.min(b.bounces, 255));
  if (o !== EVENT_BYTES) throw new Error(`protocol: event size ${o} != ${EVENT_BYTES}`);
  return buf;
}

export function decode(buf: ArrayBuffer): Decoded {
  const d = new DataView(buf);
  if (d.getUint8(0) !== PROTOCOL_VERSION) throw new Error(`protocol: version ${d.getUint8(0)} != ${PROTOCOL_VERSION}`);
  const type = d.getUint8(1);
  if (type === MSG_STATE) {
    const n = d.getUint8(2);
    const states: RemoteState[] = [];
    let o = STATE_HEADER_BYTES;
    for (let i = 0; i < n; i++) {
      const s: RemoteState = {
        tick: d.getUint32(o, true),
        round: d.getUint16(o + 4, true),
        x: d.getFloat32(o + 6, true),
        z: d.getFloat32(o + 10, true),
        action: at(ACTIONS, d.getUint8(o + 14)),
        actionTick: d.getUint16(o + 15, true),
        actionLength: d.getUint16(o + 17, true),
        meter: d.getFloat32(o + 19, true),
        stepPoints: d.getUint8(o + 23),
        countTicks: d.getInt32(o + 24, true),
        freezeTicks: d.getUint16(o + 28, true),
      };
      states.push(s);
      o += STATE_ENTRY_BYTES;
    }
    return { type: 'state', states };
  }
  if (type !== MSG_EVENT) throw new Error(`protocol: unknown message ${type}`);
  let o = 2;
  const u8 = () => { const v = d.getUint8(o); o += 1; return v; };
  const i8 = () => { const v = d.getInt8(o); o += 1; return v; };
  const u16 = () => { const v = d.getUint16(o, true); o += 2; return v; };
  const u32 = () => { const v = d.getUint32(o, true); o += 4; return v; };
  const f64 = () => { const v = d.getFloat64(o, true); o += 8; return v; };
  const seq = u32(); const tick = u32(); const round = u16();
  const kind: AuthEventKind = at(AUTH_EVENT_KINDS, u8());
  const s = side(i8());
  const value = f64(); const hp = f64(); const ballAuth = side(i8());
  const b = createBallWire();
  b.mode = at(MODES, u8()); b.holder = side(i8()); b.side = u8() === 1 ? 1 : 0;
  b.pos.x = f64(); b.pos.y = f64(); b.pos.z = f64();
  b.vel.x = f64(); b.vel.y = f64(); b.vel.z = f64();
  b.countTicks = u16(); b.freezeTicks = u16();
  b.thrower = u8() === 1 ? 1 : 0; b.receiver = u8() === 1 ? 1 : 0; b.kind = at(THROW_TYPES, u8());
  b.speedMps = f64(); b.powerMul = f64();
  b.start.x = f64(); b.start.y = f64(); b.start.z = f64();
  b.target.x = f64(); b.target.y = f64(); b.target.z = f64();
  b.lateralM = f64(); b.apexM = f64();
  const flags = u8();
  b.homing = (flags & 1) !== 0; b.evaded = (flags & 2) !== 0;
  b.evade.front = (flags & 4) !== 0; b.evade.back = (flags & 8) !== 0; b.evade.left = (flags & 16) !== 0; b.evade.right = (flags & 32) !== 0;
  b.rally = u16(); b.bounces = u8();
  return { type: 'event', event: { seq, tick, round, kind, side: s, value, hp, ballAuth, ball: b } };
}

/** 受け手申告の値域チェック（不正対策はしないが、壊れた値で sim を壊さない。netcode 規則） */
export function plausibleEvent(e: AuthEvent, maxSpeedMps: number): boolean {
  const b = e.ball;
  const finite = [e.value, b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.speedMps, b.powerMul, b.start.x, b.start.y, b.start.z]
    .every(Number.isFinite);
  return finite && b.speedMps >= 0 && b.speedMps <= maxSpeedMps && b.powerMul >= 0 && b.powerMul < 100;
}
