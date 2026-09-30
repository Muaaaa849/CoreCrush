// コートの幾何。z=0 が中央線（プラズマ・フェンス）。side 0 は z<0、side 1 は z>0。
import type { Balance, StepDir } from './balance';
import { clamp, set, type Vec3 } from './math';
import type { Side, StepDirs } from './types';

/** 相手コートへ向かう向き（z 成分のみ） */
export function forwardZ(side: Side): number {
  return side === 0 ? 1 : -1;
}

/** コート基準の入力 (right, forward) をワールドの (x, z) に変換して out に入れる（y=0） */
export function courtToWorld(side: Side, right: number, forward: number, out: Vec3): Vec3 {
  const f = forwardZ(side);
  // forward=(0,0,f) のとき right = (-f, 0, 0)
  return set(out, -f * right, 0, f * forward);
}

export function sideOfZ(z: number, fallback: Side): Side {
  return z < 0 ? 0 : z > 0 ? 1 : fallback;
}

/** プレイヤーを自陣に収める（相手コートへは入れない。INV-17） */
export function clampToOwnCourt(b: Balance, side: Side, p: Vec3): void {
  const r = b.player.bodyRadiusM;
  const halfW = b.court.widthM / 2 - r;
  const near = b.court.fenceClearanceM + r;
  const far = b.court.depthM - r;
  p.x = clamp(p.x, -halfW, halfW);
  p.z = side === 0 ? clamp(p.z, -far, -near) : clamp(p.z, near, far);
  p.y = 0;
}

export function spawnPoint(b: Balance, side: Side, out: Vec3): Vec3 {
  return set(out, 0, 0, -forwardZ(side) * b.court.spawnFromCenterM);
}

export function courtCenter(b: Balance, side: Side, out: Vec3): Vec3 {
  return set(out, 0, b.ball.radiusM, -forwardZ(side) * (b.court.depthM / 2));
}

/**
 * ステップ方向の分類（Q-04）。基準はコート固定（前＝中央線の法線方向）。
 * 境界角ちょうどは両方を有効にする。無入力は後方。
 */
export function classifyStep(b: Balance, right: number, forward: number, out: StepDirs): StepDirs {
  out.front = out.back = out.left = out.right = false;
  if (Math.hypot(right, forward) < 1e-6) {
    out.back = true;
    return out;
  }
  const a = Math.abs((Math.atan2(right, forward) * 180) / Math.PI);
  const bd = b.step.directionBoundaryDeg;
  const eps = 1e-9;
  if (a <= bd + eps) out.front = true;
  if (a >= 180 - bd - eps) out.back = true;
  if (a >= bd - eps && a <= 180 - bd + eps) {
    if (right < 0) out.left = true;
    else out.right = true;
  }
  return out;
}

export function stepDirsFrom(list: readonly StepDir[], out: StepDirs): StepDirs {
  out.front = list.includes('front');
  out.back = list.includes('back');
  out.left = list.includes('left');
  out.right = list.includes('right');
  return out;
}

export function stepDirsIntersect(a: StepDirs, b: StepDirs): boolean {
  return (a.front && b.front) || (a.back && b.back) || (a.left && b.left) || (a.right && b.right);
}
