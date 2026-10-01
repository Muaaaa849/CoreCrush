// 汎用の火花（GDD 13。ADR 0008）。CPU で動かす尾付きの粒を、1 本の頂点バッファ・1 ドローコールで描く。
// - 粒は事前確保の配列を使い回す（試合中に new しない）。満杯なら一番古い粒を上書き
// - 粒は速度の向きに伸びた細い四角（カメラを向く）。遠くで細くなりすぎないよう幅に画面上の px の下限
// - 加算合成・深度書き込みなし。輝度は data/vfx/impact.json（コアの顔より暗い。validate-data で検査）
import * as THREE from 'three/webgpu';
import { abs, attribute, float } from 'three/tsl';

export interface SparkLook {
  count: number;
  speedMps: number;
  speedJitter: number;
  spreadDeg: number;
  lifeSec: number;
  streakSec: number;
  hdr: number;
  gravityMps2: number;
  dragPerSec: number;
}

export class Sparks {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly p: Float32Array; // 位置 xyz
  private readonly v: Float32Array; // 速度 xyz
  private readonly c: Float32Array; // 色（HDR を掛けた後）rgb
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly streak: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private alive = 0;
  private countMul = 1;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: THREE.BufferAttribute;
  private readonly uvA: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly size = new THREE.Vector2();

  constructor(capacity: number, private readonly widthM: number, private readonly minWidthPx: number) {
    const n = (this.n = capacity);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.c = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.streak = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);

    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
    this.uvA = new THREE.BufferAttribute(new Float32Array(n * 4 * 2), 2);
    this.col = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
    for (const a of [this.pos, this.uvA, this.col]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('sparkUv', this.uvA);
    this.geo.setAttribute('sparkColor', this.col);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 4;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    // sparkUv: x = 0 先頭 → 1 尾、y = 横 0〜1。先頭が明るく尾へ消える
    const uvN = attribute<'vec2'>('sparkUv', 'vec2');
    const across = float(1).sub(abs(uvN.y.mul(2).sub(1)));
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    mat.colorNode = attribute<'vec3'>('sparkColor', 'vec3');
    mat.opacityNode = float(1).sub(uvN.x).mul(across);
    mat.fog = false;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** 画質の粒子倍率（粒の数に掛ける） */
  applyQuality(particleMul: number): void {
    this.countMul = particleMul;
  }

  /**
   * 粒を噴き出す。向き (dx,dy,dz) を軸に全角 spreadDeg の円錐へ散らす
   * @param color 線形色（HDR を掛ける前）
   */
  emit(look: SparkLook, x: number, y: number, z: number, dx: number, dy: number, dz: number, color: THREE.Color): void {
    const count = Math.round(look.count * this.countMul);
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / dl, ay = dy / dl, az = dz / dl;
    // 軸に垂直な 2 方向
    let ux = -az, uy = 0, uz = ax;
    if (Math.hypot(ux, uz) < 1e-3) { ux = 1; uy = 0; uz = 0; }
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul; uy /= ul; uz /= ul;
    const wx = ay * uz - az * uy, wy = az * ux - ax * uz, wz = ax * uy - ay * ux;
    const cosMax = Math.cos(THREE.MathUtils.degToRad(look.spreadDeg / 2));
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      // 円錐の中で一様な向き（描画の演出なので Math.random でよい。sim は使わない）
      const cz = 1 - Math.random() * (1 - cosMax);
      const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
      const ph = Math.random() * Math.PI * 2;
      const ex = Math.cos(ph) * sz, ey = Math.sin(ph) * sz;
      const sp = look.speedMps * (1 - look.speedJitter * Math.random());
      const o = i * 3;
      this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z;
      this.v[o] = (ax * cz + ux * ex + wx * ey) * sp;
      this.v[o + 1] = (ay * cz + uy * ex + wy * ey) * sp;
      this.v[o + 2] = (az * cz + uz * ex + wz * ey) * sp;
      this.c[o] = color.r * look.hdr; this.c[o + 1] = color.g * look.hdr; this.c[o + 2] = color.b * look.hdr;
      this.age[i] = 0;
      this.life[i] = look.lifeSec * (0.6 + 0.4 * Math.random());
      this.streak[i] = look.streakSec;
      this.grav[i] = look.gravityMps2;
      this.drag[i] = look.dragPerSec;
    }
  }

  clear(): void {
    this.age.fill(1);
    this.life.fill(1);
    this.alive = 0;
    this.geo.setDrawRange(0, 0);
  }

  /** 毎フレーム。粒を進めて頂点を組み直す */
  update(dtSec: number, cam: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer): void {
    const n = this.n;
    const P = this.pos.array as Float32Array;
    const U = this.uvA.array as Float32Array;
    const C = this.col.array as Float32Array;
    renderer.getSize(this.size);
    const mPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(this.size.y, 1);
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (this.age[i]! >= this.life[i]!) continue;
      this.age[i]! += dtSec;
      const o = i * 3;
      const f = Math.max(0, 1 - this.drag[i]! * dtSec);
      this.v[o]! *= f; this.v[o + 1]! *= f; this.v[o + 2]! *= f;
      this.v[o + 1]! -= this.grav[i]! * dtSec;
      this.p[o]! += this.v[o]! * dtSec; this.p[o + 1]! += this.v[o + 1]! * dtSec; this.p[o + 2]! += this.v[o + 2]! * dtSec;
      if (this.age[i]! >= this.life[i]!) continue;
      const x = this.p[o]!, y = this.p[o + 1]!, z = this.p[o + 2]!;
      const vx = this.v[o]!, vy = this.v[o + 1]!, vz = this.v[o + 2]!;
      // 尾: 速度の逆向き
      const s = this.streak[i]!;
      const tx = x - vx * s, ty = y - vy * s, tz = z - vz * s;
      // 横 = 速度 × 視線
      const lx = cx - x, ly = cy - y, lz = cz - z;
      let sx = vy * lz - vz * ly, sy = vz * lx - vx * lz, sz = vx * ly - vy * lx;
      const sl = Math.hypot(sx, sy, sz);
      if (sl < 1e-6) { sx = 0; sy = 1; sz = 0; } else { sx /= sl; sy /= sl; sz /= sl; }
      const fade = 1 - this.age[i]! / this.life[i]!;
      const w = Math.max(this.widthM, this.minWidthPx * mPerPx * Math.hypot(lx, ly, lz)) * 0.5 * (0.4 + 0.6 * fade);
      const q = k * 12;
      P[q] = x + sx * w; P[q + 1] = y + sy * w; P[q + 2] = z + sz * w;
      P[q + 3] = x - sx * w; P[q + 4] = y - sy * w; P[q + 5] = z - sz * w;
      P[q + 6] = tx + sx * w; P[q + 7] = ty + sy * w; P[q + 8] = tz + sz * w;
      P[q + 9] = tx - sx * w; P[q + 10] = ty - sy * w; P[q + 11] = tz - sz * w;
      const u = k * 8;
      U[u] = 0; U[u + 1] = 0; U[u + 2] = 0; U[u + 3] = 1; U[u + 4] = 1; U[u + 5] = 0; U[u + 6] = 1; U[u + 7] = 1;
      const r = this.c[o]! * fade, g = this.c[o + 1]! * fade, b = this.c[o + 2]! * fade;
      for (let v = 0; v < 4; v++) { C[q + v * 3] = r; C[q + v * 3 + 1] = g; C[q + v * 3 + 2] = b; }
      k++;
    }
    if (k === 0 && this.alive === 0) return;
    this.alive = k;
    this.pos.needsUpdate = true;
    this.uvA.needsUpdate = true;
    this.col.needsUpdate = true;
    this.geo.setDrawRange(0, k * 6);
  }
}
