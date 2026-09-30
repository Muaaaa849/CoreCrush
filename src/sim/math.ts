// sim 用の最小ベクトル演算（three 非依存・破壊的更新でアロケーションを避ける）
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function set(o: Vec3, x: number, y: number, z: number): Vec3 {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
}
export function copy(o: Vec3, a: Vec3): Vec3 {
  return set(o, a.x, a.y, a.z);
}
export function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 線分 p0-p1 と、縦の線分（x,z 固定、y は y0〜y1）の最短距離 */
export function segmentToVerticalSegmentDist(p0: Vec3, p1: Vec3, x: number, z: number, y0: number, y1: number): number {
  // 線分上の点 p(t) = p0 + (p1-p0)t。水平距離が最小になる t を求め、周辺をサンプルする代わりに解析的に解く。
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const dd = dx * dx + dz * dz;
  let t = dd > 1e-12 ? ((x - p0.x) * dx + (z - p0.z) * dz) / dd : 0;
  t = clamp(t, 0, 1);
  const px = p0.x + dx * t;
  const pz = p0.z + dz * t;
  const py = p0.y + (p1.y - p0.y) * t;
  const cy = clamp(py, y0, y1);
  return Math.hypot(px - x, py - cy, pz - z);
}
