// ボールの運動。
// - flight: 誘導曲線。p(u) = S + (T−S)u + 横膨らみ·sin(πu) + 頂点·sin(πu)。追尾中は T＝受け手の胸を毎 tick 更新
//   （がっつり追尾・かする距離では吸着。Q-05）。速さは弧長で一定（到達タイミングが読める。INV-21）。
//   頂点・横膨らみは天井・側壁の手前にクランプ（INV-22）。追尾解除（ステップ）で T を固定する。
// - linear: 狙い投げ。重力なしの直進。
// - loose: 床・壁で低反発する簡易物理。
import type { Balance, ThrowTypeData } from './balance';
import { dtSec } from './balance';
import { copy, len, segmentToVerticalSegmentDist, set, vec3, type Vec3 } from './math';
import type { Ball, FlightKind, Player, Side, World } from './types';
import { forwardZ, sideOfZ, stepDirsFrom } from './court';

const tmpD = vec3();

export function chestOf(b: Balance, p: Player, out: Vec3): Vec3 {
  return set(out, p.pos.x, b.player.chestHeightM, p.pos.z);
}

export function handOf(b: Balance, p: Player, out: Vec3): Vec3 {
  return set(out, p.pos.x, b.player.handHeightM, p.pos.z + forwardZ(p.side) * b.player.handForwardM);
}

export function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

/** 受け手の体（縦カプセル）とボールが接触しているか（線分 a→b で判定） */
export function touchesBody(b: Balance, p: Player, a: Vec3, bb: Vec3): boolean {
  const r = b.player.bodyRadiusM;
  const d = segmentToVerticalSegmentDist(a, bb, p.pos.x, p.pos.z, r, b.player.bodyHeightM - r);
  return d <= r + b.ball.radiusM;
}

export function launchFlight(
  w: World,
  from: Player,
  kind: FlightKind,
  speedMps: number,
  powerMul: number,
  data: Pick<ThrowTypeData, 'lateralM' | 'apexM' | 'homing' | 'evade'>,
  rally: number,
): void {
  const b = w.balance;
  const ball = w.ball;
  const to = w.players[other(from.side)];
  ball.mode = 'flight';
  ball.holder = -1;
  from.holding = false;
  ball.thrower = from.side;
  ball.receiver = to.side;
  ball.kind = kind;
  ball.speedMps = speedMps;
  ball.powerMul = powerMul;
  handOf(b, from, ball.start);
  chestOf(b, to, ball.target);
  copy(ball.pos, ball.start);
  copy(ball.prevPos, ball.start);
  ball.u = 0;
  ball.lateralM = data.lateralM;
  ball.apexM = data.apexM;
  ball.homing = data.homing;
  ball.evaded = false;
  stepDirsFrom(data.evade, ball.evade);
  ball.rally = rally;
}

export function launchLinear(w: World, from: Player, speedMps: number, powerMul: number, dir: Vec3): void {
  const b = w.balance;
  const ball = w.ball;
  ball.mode = 'linear';
  ball.holder = -1;
  from.holding = false;
  ball.thrower = from.side;
  ball.receiver = other(from.side);
  ball.kind = 'aimed';
  ball.speedMps = speedMps;
  ball.powerMul = powerMul;
  handOf(b, from, ball.start);
  copy(ball.pos, ball.start);
  copy(ball.prevPos, ball.start);
  const l = len(dir) || 1;
  set(ball.vel, (dir.x / l) * speedMps, (dir.y / l) * speedMps, (dir.z / l) * speedMps);
  ball.homing = false;
  ball.evaded = false;
  ball.evade.front = ball.evade.back = ball.evade.left = ball.evade.right = false;
  ball.rally = 0;
}

/** 実効の横膨らみ・頂点（天井・側壁の手前に収める） */
function effectiveShape(b: Balance, ball: Ball, out: { lat: number; apex: number; lx: number; lz: number }): void {
  const S = ball.start;
  const T = ball.target;
  const hx = T.x - S.x;
  const hz = T.z - S.z;
  const hl = Math.hypot(hx, hz) || 1;
  // 弦の水平方向 h に対し、投げ手から見た左 = (h.z, 0, -h.x)
  out.lx = hz / hl;
  out.lz = -hx / hl;
  const margin = b.court.trajectoryMarginM + b.ball.radiusM;
  out.apex = Math.min(ball.apexM, Math.max(0, b.court.ceilingM - margin - Math.max(S.y, T.y)));
  const room = Math.max(0, b.court.widthM / 2 - margin - Math.max(Math.abs(S.x), Math.abs(T.x)));
  const lx = Math.abs(out.lx);
  const maxLat = lx > 1e-6 ? room / lx : Math.abs(ball.lateralM);
  out.lat = Math.sign(ball.lateralM) * Math.min(Math.abs(ball.lateralM), maxLat);
}

const shape = { lat: 0, apex: 0, lx: 0, lz: 0 };

export function flightPoint(b: Balance, ball: Ball, u: number, out: Vec3): Vec3 {
  effectiveShape(b, ball, shape);
  const S = ball.start;
  const T = ball.target;
  const s = Math.sin(Math.PI * u);
  return set(
    out,
    S.x + (T.x - S.x) * u + shape.lx * shape.lat * s,
    S.y + (T.y - S.y) * u + shape.apex * s,
    S.z + (T.z - S.z) * u + shape.lz * shape.lat * s,
  );
}

export function flightDerivative(b: Balance, ball: Ball, u: number, out: Vec3): Vec3 {
  effectiveShape(b, ball, shape);
  const S = ball.start;
  const T = ball.target;
  const c = Math.PI * Math.cos(Math.PI * u);
  return set(out, T.x - S.x + shape.lx * shape.lat * c, T.y - S.y + shape.apex * c, T.z - S.z + shape.lz * shape.lat * c);
}

export type FlightResult = 'none' | 'contact' | 'miss';

/** flight を1 tick 進める。contact＝受け手の体に届いた（防御・被弾の判定へ）、miss＝外れて loose へ */
export function advanceFlight(w: World): FlightResult {
  const b = w.balance;
  const ball = w.ball;
  const receiver = w.players[ball.receiver];
  if (ball.homing) chestOf(b, receiver, ball.target);
  flightDerivative(b, ball, ball.u, tmpD);
  const dl = len(tmpD);
  const du = dl > 1e-9 ? (ball.speedMps * dtSec(b)) / dl : 1;
  ball.u = Math.min(1, ball.u + du);
  copy(ball.prevPos, ball.pos);
  flightPoint(b, ball, ball.u, ball.pos);
  if (ball.homing) return ball.u >= 1 ? 'contact' : 'none';
  if (!ball.evaded && touchesBody(b, receiver, ball.prevPos, ball.pos)) return 'contact';
  if (ball.u >= 1) {
    flightDerivative(b, ball, 1, tmpD);
    const l = len(tmpD) || 1;
    set(ball.vel, (tmpD.x / l) * ball.speedMps, (tmpD.y / l) * ball.speedMps, (tmpD.z / l) * ball.speedMps);
    ball.mode = 'loose';
    ball.bounces = 0;
    return 'miss';
  }
  return 'none';
}

/** linear を1 tick 進める */
export function advanceLinear(w: World): FlightResult {
  const b = w.balance;
  const ball = w.ball;
  const dt = dtSec(b);
  copy(ball.prevPos, ball.pos);
  set(ball.pos, ball.pos.x + ball.vel.x * dt, ball.pos.y + ball.vel.y * dt, ball.pos.z + ball.vel.z * dt);
  if (touchesBody(b, w.players[ball.receiver], ball.prevPos, ball.pos)) return 'contact';
  const r = b.ball.radiusM;
  if (ball.pos.y <= r || ball.pos.y >= b.court.ceilingM - r || Math.abs(ball.pos.x) >= b.court.widthM / 2 - r || Math.abs(ball.pos.z) >= b.court.depthM - r) {
    ball.mode = 'loose';
    ball.bounces = 0;
    return 'miss';
  }
  return 'none';
}

/** loose を1 tick 進める（床・壁・天井で低反発。INV-22） */
export function advanceLoose(w: World): void {
  const b = w.balance;
  const ball = w.ball;
  const dt = dtSec(b);
  const r = b.ball.radiusM;
  const v = ball.vel;
  copy(ball.prevPos, ball.pos);
  const onFloor = ball.pos.y <= r + 1e-6 && Math.abs(v.y) < 1e-6;
  if (!onFloor) v.y -= b.ball.gravityMps2 * dt;
  ball.pos.x += v.x * dt;
  ball.pos.y += v.y * dt;
  ball.pos.z += v.z * dt;
  if (ball.pos.y < r) {
    ball.pos.y = r;
    if (v.y < 0) {
      // 跳ね返りの速さに上限（どんな高速球でも 1〜2 回で落ち着く。INV-22）
      const out = Math.min(-v.y * b.ball.floorRestitution, b.ball.maxBounceMps);
      if (out >= b.ball.restSpeedMps) {
        v.y = out;
        ball.bounces++;
      } else v.y = 0;
    }
  }
  const top = b.court.ceilingM - r;
  if (ball.pos.y > top) {
    ball.pos.y = top;
    if (v.y > 0) v.y = -v.y * b.ball.wallRestitution;
  }
  const hw = b.court.widthM / 2 - r;
  if (Math.abs(ball.pos.x) > hw) {
    ball.pos.x = Math.sign(ball.pos.x) * hw;
    v.x = -v.x * b.ball.wallRestitution;
  }
  const hd = b.court.depthM - r;
  if (Math.abs(ball.pos.z) > hd) {
    ball.pos.z = Math.sign(ball.pos.z) * hd;
    v.z = -v.z * b.ball.wallRestitution;
  }
  if (ball.pos.y <= r + 1e-6 && v.y === 0) {
    const k = Math.max(0, 1 - b.ball.floorFrictionPerSec * dt);
    v.x *= k;
    v.z *= k;
    if (Math.hypot(v.x, v.z) < b.ball.restSpeedMps * dt) v.x = v.z = 0;
  }
}

export function dropAt(w: World, p: Player): void {
  const ball = w.ball;
  ball.mode = 'loose';
  ball.holder = -1;
  p.holding = false;
  set(ball.pos, p.pos.x, w.balance.ball.radiusM, p.pos.z);
  copy(ball.prevPos, ball.pos);
  set(ball.vel, 0, 0, 0);
  ball.bounces = 0;
}

export function currentSide(ball: Ball, players: [Player, Player]): Side {
  if (ball.mode === 'held' && ball.holder !== -1) return players[ball.holder].side;
  return sideOfZ(ball.pos.z, ball.side);
}

