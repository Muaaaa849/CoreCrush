// 当たりの演出（GDD 13）。キャッチ・跳ね返し・フェンス通過（「成功の気持ちよさ最優先」）と、爆発（閃光＋破片＋衝撃波）。
// - リングは事前に作った板（ringPool 枚）を使い回す。球が来た向き・床・カメラのどれかに面を向け、TSL で広がる輪と出始めの閃光を描く
// - 火花・破片は Sparks（1 ドローコール。ADR 0008）
// - ジャストキャッチは別の見た目（金色・二重の輪・多い火花）。跳ね返しは返した球の軌跡の色
// - 爆発の火の玉はカメラを向く板（2 枚を使い回す）。コアより明るいのは出始めの閃光（flashSec）だけ
// - sim の時間は止めない（ヒットストップは入れない。OPEN: Q-11）。数値は data/vfx/impact.json・explosion.json
import * as THREE from 'three/webgpu';
import { exp, float, max, mix, smoothstep, uniform, uv } from 'three/tsl';
import impactJson from '../../data/vfx/impact.json';
import explosionJson from '../../data/vfx/explosion.json';
import { Sparks, type SparkLook } from './sparks';

export type ImpactKind = 'catch' | 'justCatch' | 'parry' | 'fenceCross';

export interface RingLook { radiusM: number; widthMul: number; lifeSec: number; hdr: number; fill: number }
export interface ImpactPreset { color: string; rings: RingLook[]; sparks: SparkLook }
export interface ImpactLook {
  sparkPool: number;
  ringPool: number;
  sparkWidthM: number;
  sparkMinWidthPx: number;
  presets: Record<ImpactKind, ImpactPreset>;
}
export interface ExplosionLook {
  fireball: { radiusM: number; growSec: number; lifeSec: number; color: string; coreColor: string; hdr: number; flashHdr: number; flashSec: number };
  rings: (RingLook & { atFloor: boolean; color: string })[];
  sparks: SparkLook & { color: string };
  debris: SparkLook & { color: string };
}

export const IMPACT: ImpactLook = impactJson as ImpactLook;
export const EXPLOSION: ExplosionLook = explosionJson as ExplosionLook;

interface Ring {
  mesh: THREE.Mesh;
  /** 0〜1 の進み（1 以上で空き） */
  t: { value: number };
  color: { value: THREE.Color };
  width: { value: number };
  fill: { value: number };
  lifeSec: number;
  /** カメラを向く */
  billboard: boolean;
}

interface Fireball {
  mesh: THREE.Mesh;
  ageSec: number;
  intensity: { value: number };
}

const FIREBALL_POOL = 2;

export class ImpactFx {
  readonly group = new THREE.Group();
  private readonly sparks: Sparks;
  private readonly rings: Ring[] = [];
  private next = 0;
  private readonly fireballs: Fireball[] = [];
  private nextFire = 0;
  private readonly tmp = new THREE.Color();

  constructor(private readonly look: ImpactLook = IMPACT, private readonly ex: ExplosionLook = EXPLOSION) {
    this.sparks = new Sparks(look.sparkPool, look.sparkWidthM, look.sparkMinWidthPx);
    this.group.add(this.sparks.mesh);
    const geo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < look.ringPool; i++) {
      const t = uniform(1);
      const col = uniform(new THREE.Color());
      const width = uniform(0.1);
      const fill = uniform(0);
      // 板の中心からの距離（0〜1 が半径）。輪は広がりながら暗く、内側は出始めだけ光る
      const d = uv().sub(0.5).mul(2).length();
      const r = float(1).sub(float(1).sub(t).pow(3)).mul(0.85); // イーズアウト
      const ringN = exp(d.sub(r).div(max(width, 0.001)).pow(2).negate());
      const fadeN = float(1).sub(t).pow(2);
      const flash = fill.mul(float(1).sub(smoothstep(0, r.max(0.05), d))).mul(float(1).sub(t).pow(4));
      const edge = float(1).sub(smoothstep(0.9, 1, d));
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      mat.colorNode = col;
      mat.opacityNode = ringN.mul(fadeN).add(flash).mul(edge);
      mat.fog = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.rings.push({ mesh, t, color: col, width, fill, lifeSec: 1, billboard: false });
    }
    // 爆発の火の玉: 中心が白く外へ橙、縁は柔らかく消える。明るさ（intensity）は CPU で時間に合わせて渡す
    const F = ex.fireball;
    for (let i = 0; i < FIREBALL_POOL; i++) {
      const intensity = uniform(0);
      const d = uv().sub(0.5).mul(2).length();
      const body = float(1).sub(smoothstep(0.35, 1, d));
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      mat.colorNode = mix(new THREE.Color(F.coreColor), new THREE.Color(F.color), smoothstep(0, 0.7, d)).mul(intensity);
      mat.opacityNode = body;
      mat.fog = false;
      // 床に刺さった縁が切れないよう深度を見ない（0.65 秒の加算の光）
      mat.depthTest = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.fireballs.push({ mesh, ageSec: 1e9, intensity });
    }
  }

  applyQuality(particleMul: number): void {
    this.sparks.applyQuality(particleMul);
  }

  private spawnRing(R: RingLook, c: THREE.Color, x: number, y: number, z: number, nx: number, ny: number, nz: number, billboard: boolean): void {
    const ring = this.rings[this.next]!;
    this.next = (this.next + 1) % this.rings.length;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, y, z);
    if (!billboard) ring.mesh.lookAt(x + nx, y + ny, z + nz);
    ring.billboard = billboard;
    // カメラを向く板は床に刺さると縁が切れるので深度を見ない（短い加算の光だけ）
    (ring.mesh.material as THREE.Material).depthTest = !billboard;
    ring.mesh.scale.setScalar(R.radiusM);
    ring.t.value = 0;
    ring.lifeSec = R.lifeSec;
    ring.width.value = R.widthMul;
    ring.fill.value = R.fill;
    ring.color.value.copy(c).multiplyScalar(R.hdr);
  }

  /**
   * キャッチ・跳ね返し・フェンス通過
   * @param dir 面の向き・火花の向き（キャッチ・跳ね返しは投げ手の方、フェンスは球の進行方向）
   * @param trailColor color が "trail" のプリセットで使う色（軌跡と同じ。線形）
   */
  play(kind: ImpactKind, x: number, y: number, z: number, dx: number, dy: number, dz: number, trailColor: THREE.Color): void {
    const P = this.look.presets[kind];
    const c = P.color === 'trail' ? this.tmp.copy(trailColor) : this.tmp.set(P.color);
    for (const R of P.rings) this.spawnRing(R, c, x, y, z, dx, dy, dz, false);
    this.sparks.emit(P.sparks, x, y, z, dx, dy, dz, c);
  }

  /** 爆発（8 秒カウント）。位置は爆発した球の表示位置 */
  explode(x: number, y: number, z: number): void {
    const E = this.ex;
    for (const R of E.rings) {
      this.tmp.set(R.color);
      if (R.atFloor) this.spawnRing(R, this.tmp, x, 0.05, z, 0, 1, 0, false);
      else this.spawnRing(R, this.tmp, x, y, z, 0, 0, 1, true);
    }
    const fb = this.fireballs[this.nextFire]!;
    this.nextFire = (this.nextFire + 1) % this.fireballs.length;
    fb.mesh.position.set(x, Math.max(y, E.fireball.radiusM * 0.35), z);
    fb.ageSec = 0;
    fb.mesh.visible = true;
    // 破片は上向きの半球寄り、火花は全方向
    this.sparks.emit(E.sparks, x, y, z, 0, 1, 0, this.tmp.set(E.sparks.color));
    this.sparks.emit(E.debris, x, y, z, 0, 1, 0, this.tmp.set(E.debris.color));
  }

  clear(): void {
    for (const r of this.rings) { r.t.value = 1; r.mesh.visible = false; }
    for (const f of this.fireballs) { f.ageSec = 1e9; f.mesh.visible = false; }
    this.sparks.clear();
  }

  update(dtSec: number, cam: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer): void {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t.value += dtSec / r.lifeSec;
      if (r.t.value >= 1) r.mesh.visible = false;
      else if (r.billboard) r.mesh.quaternion.copy(cam.quaternion);
    }
    const F = this.ex.fireball;
    for (const f of this.fireballs) {
      if (!f.mesh.visible) continue;
      f.ageSec += dtSec;
      if (f.ageSec >= F.lifeSec) {
        f.mesh.visible = false;
        continue;
      }
      // 一気に膨らみ（growSec）、その後ゆっくり広がりながら消える。閃光は flashSec だけ
      const g = Math.min(f.ageSec / F.growSec, 1);
      const k = f.ageSec / F.lifeSec;
      f.mesh.scale.setScalar(F.radiusM * (1 - (1 - g) * (1 - g)) * (1 + 0.25 * k));
      const flash = f.ageSec < F.flashSec ? F.flashHdr * (1 - f.ageSec / F.flashSec) : 0;
      f.intensity.value = Math.max(flash, F.hdr * (1 - k) * (1 - k));
      f.mesh.quaternion.copy(cam.quaternion);
    }
    this.sparks.update(dtSec, cam, renderer);
  }
}
