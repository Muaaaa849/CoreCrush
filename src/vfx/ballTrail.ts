// ボールの軌跡（GDD 13。コアの見つけやすさを担う。ADR 0007 で光の輪・柱を撤回した代わり）。
// プランナー指示（2026-10-01）: 形は球種で変えず、色で分ける（ストレート=赤、左右カーブ=黄、上カーブ=青）。
// ラリーで球が速くなるほど色が濃くなる（投げた球は淡い）。
// - 飛翔中だけ点を積む。持っている・転がっている球には出さない（残りは寿命で消える）
// - カメラを向くリボン。頂点バッファは作ったものを使い回す（試合中に new しない）
// - 遠くで細くなりすぎないよう、先頭の幅に画面上の px の下限を付ける
// - 芯だけブルームのしきい値を少し超える。コアの顔より暗い（validate-data で検査）
// 数値は data/vfx/ballTrail.json。描画側の位置（補間・外挿後）を読むだけで sim は触らない。
import * as THREE from 'three/webgpu';
import { abs, attribute, float, mix } from 'three/tsl';
import type { FlightKind } from '../sim/types';
import trailJson from '../../data/vfx/ballTrail.json';

export interface BallTrailLook {
  lifeSec: number;
  maxSamples: number;
  minSampleM: number;
  breakM: number;
  widthM: number;
  tailWidthMul: number;
  minWidthPx: number;
  coreHdr: number;
  edgeHdr: number;
  colors: Record<FlightKind, string>;
  rally: { paleMix: number; fullRally: number };
}

export const BALL_TRAIL: BallTrailLook = trailJson as BallTrailLook;

/** 球種とラリー回数から軌跡の色（線形色空間）。ラリー 0 は白に寄せて淡く、fullRally 回で球種の色そのもの */
export function trailColor(look: BallTrailLook, kind: FlightKind, rally: number, out: THREE.Color): THREE.Color {
  const t = Math.min(Math.max(rally, 0) / look.rally.fullRally, 1);
  const pale = look.rally.paleMix * (1 - t);
  out.set(look.colors[kind]);
  out.r += (1 - out.r) * pale;
  out.g += (1 - out.g) * pale;
  out.b += (1 - out.b) * pale;
  return out;
}

export class BallTrail {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  // 点のリング（head が最新）。位置・生まれた時刻・色
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly born: Float64Array;
  private readonly cr: Float32Array;
  private readonly cg: Float32Array;
  private readonly cb: Float32Array;
  private head = -1;
  private count = 0;
  private minSampleM: number;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: THREE.BufferAttribute;
  private readonly uvA: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly tmpColor = new THREE.Color();
  private readonly size = new THREE.Vector2();

  constructor(private readonly look: BallTrailLook = BALL_TRAIL) {
    const n = (this.n = look.maxSamples);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.born = new Float64Array(n);
    this.cr = new Float32Array(n);
    this.cg = new Float32Array(n);
    this.cb = new Float32Array(n);
    this.minSampleM = look.minSampleM;

    // 点ごとに左右 2 頂点。添字は固定（点 i と i+1 の間を 2 三角形）
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.uvA = new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2);
    this.col = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    for (const a of [this.pos, this.uvA, this.col]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('trailUv', this.uvA);
    this.geo.setAttribute('trailColor', this.col);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    // 毎フレーム頂点を書き換えるので、境界は大きく取って視錐台カリングで消えないようにする
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    // trailUv: x = 寿命の割合（0 先頭 → 1 消える）、y = 横（0〜1。中央が芯）
    const uvN = attribute<'vec2'>('trailUv', 'vec2');
    const across = float(1).sub(abs(uvN.y.mul(2).sub(1)));
    const fade = float(1).sub(uvN.x);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    mat.colorNode = attribute<'vec3'>('trailColor', 'vec3').mul(mix(float(look.edgeHdr), float(look.coreHdr), across.mul(across)));
    mat.opacityNode = fade.mul(fade).mul(across.sqrt());
    mat.fog = false;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** 画質の粒子倍率（低いほど点の間隔を広げる） */
  applyQuality(particleMul: number): void {
    this.minSampleM = this.look.minSampleM / Math.max(particleMul, 0.1);
  }

  clear(): void {
    this.head = -1;
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  /**
   * 毎フレーム呼ぶ。flying のときだけ球の位置を積み、寿命の切れた点を捨ててリボンを組み直す
   * @param fovDeg 縦の画角、viewH はキャンバスの高さ（CSS px）。幅の px 下限に使う
   */
  update(
    nowSec: number, flying: boolean, x: number, y: number, z: number, kind: FlightKind, rally: number,
    cam: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer,
  ): void {
    const L = this.look;
    if (flying) {
      const h = this.head;
      if (h >= 0 && this.count > 0) {
        const d = Math.hypot(x - this.px[h]!, y - this.py[h]!, z - this.pz[h]!);
        if (d > L.breakM) this.clear();
      }
      trailColor(L, kind, rally, this.tmpColor);
      const hh = this.head;
      const moved = hh < 0 || this.count === 0 || Math.hypot(x - this.px[hh]!, y - this.py[hh]!, z - this.pz[hh]!) >= this.minSampleM;
      // 動きが小さいときは先頭の点を今の位置へ動かす（積まない）
      const i = moved ? (this.head + 1) % this.n : hh;
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.cr[i] = this.tmpColor.r; this.cg[i] = this.tmpColor.g; this.cb[i] = this.tmpColor.b;
      if (moved) {
        this.born[i] = nowSec;
        this.head = i;
        this.count = Math.min(this.count + 1, this.n);
      }
    }
    // 寿命切れを末尾から落とす
    while (this.count > 0) {
      const tail = (this.head - this.count + 1 + this.n) % this.n;
      if (nowSec - this.born[tail]! < L.lifeSec) break;
      this.count--;
    }
    if (this.count < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    this.build(nowSec, cam, renderer);
  }

  private build(nowSec: number, cam: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer): void {
    const L = this.look;
    const n = this.n;
    const P = this.pos.array as Float32Array;
    const U = this.uvA.array as Float32Array;
    const C = this.col.array as Float32Array;
    renderer.getSize(this.size);
    // 距離 1m で 1 CSS px が何 m か
    const mPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(this.size.y, 1);
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    let sx = 0, sy = 1, sz = 0;
    for (let k = 0; k < this.count; k++) {
      // k=0 が先頭（最新）
      const i = (this.head - k + n) % n;
      const ip = (this.head - Math.max(k - 1, 0) + n) % n;
      const iq = (this.head - Math.min(k + 1, this.count - 1) + n) % n;
      const x = this.px[i]!, y = this.py[i]!, z = this.pz[i]!;
      // 接線（前後の点から）× 視線 = リボンの横方向
      const tx = this.px[ip]! - this.px[iq]!, ty = this.py[ip]! - this.py[iq]!, tz = this.pz[ip]! - this.pz[iq]!;
      const vx = cx - x, vy = cy - y, vz = cz - z;
      const ax = ty * vz - tz * vy, ay = tz * vx - tx * vz, az = tx * vy - ty * vx;
      const al = Math.hypot(ax, ay, az);
      // 球がまっすぐこちらへ来るときは横が決まらない → 直前の向きを使う
      if (al > 1e-6) { sx = ax / al; sy = ay / al; sz = az / al; }
      const age = Math.min((nowSec - this.born[i]!) / L.lifeSec, 1);
      const dist = Math.hypot(vx, vy, vz);
      const w = Math.max(L.widthM, L.minWidthPx * mPerPx * dist) * (1 + (L.tailWidthMul - 1) * age) * 0.5;
      const o = k * 6;
      P[o] = x + sx * w; P[o + 1] = y + sy * w; P[o + 2] = z + sz * w;
      P[o + 3] = x - sx * w; P[o + 4] = y - sy * w; P[o + 5] = z - sz * w;
      const u = k * 4;
      U[u] = age; U[u + 1] = 0; U[u + 2] = age; U[u + 3] = 1;
      C[o] = C[o + 3] = this.cr[i]!;
      C[o + 1] = C[o + 4] = this.cg[i]!;
      C[o + 2] = C[o + 5] = this.cb[i]!;
    }
    this.pos.needsUpdate = true;
    this.uvA.needsUpdate = true;
    this.col.needsUpdate = true;
    this.geo.setDrawRange(0, (this.count - 1) * 6);
  }
}
