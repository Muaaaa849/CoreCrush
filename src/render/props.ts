// コート外周の小物（CC0 の 3D モデル、art/models.json → assets/models/*.glb）。
// 置き場所は data/render.json の stage.props。モデルの部品（プリミティブ）ごとに InstancedMesh 1 つ（置く数によらず描画 1 回）。
// 画質の decorMul で置く数を減らす（並びの先頭ほど残す）。読めない環境では何も置かない。
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { canLoadFiles, getKtx2Loader } from './assets';

/** [x, y, z, 向き(度), 倍率]。向きが省略か null ならコートの中心を向く */
export type PropItem = [number, number, number, (number | null)?, number?];

export interface PropGroup {
  model: string;
  /** x を反転した位置にも置く */
  mirrorX: boolean;
  /** z を反転した位置にも置く */
  mirrorZ: boolean;
  items: PropItem[];
}

export interface FireLook {
  model: string;
  color: string;
  lightIntensity: number;
  lightRangeM: number;
  glowHdr: number;
  heightM: number;
  flicker: number;
}

export class Props {
  readonly group = new THREE.Group();
  private readonly instanced: { mesh: THREE.InstancedMesh; max: number }[] = [];
  private readonly fires: { light: THREE.PointLight; glow: THREE.Mesh; base: number; phase: number }[] = [];
  private decorMul = 1;

  constructor(private readonly groups: PropGroup[], private readonly fire: FireLook) {}

  async load(renderer: THREE.WebGPURenderer): Promise<void> {
    if (!canLoadFiles()) return;
    const loader = new GLTFLoader().setKTX2Loader(getKtx2Loader(renderer)).setMeshoptDecoder(MeshoptDecoder);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    // まとめて並行に読む（1 つずつだと遅い）
    const loaded = await Promise.all(this.groups.map((g) => loader.loadAsync(`assets/models/${g.model}.glb`).catch((e: unknown) => {
      console.warn(`モデル ${g.model} を読めませんでした`, e);
      return null;
    })));
    this.groups.forEach((g, gi) => {
      const gltf = loaded[gi];
      if (!gltf) return;
      // 置く位置（反転を展開）と向き
      const placed: THREE.Matrix4[] = [];
      for (const [x, y, z, rot, s] of g.items) {
        const xs = g.mirrorX ? [x, -x] : [x];
        const zs = g.mirrorZ ? [z, -z] : [z];
        for (const px of xs) {
          for (const pz of zs) {
            const yaw = rot === undefined || rot === null ? Math.atan2(-px, -pz) : THREE.MathUtils.degToRad(rot) * Math.sign(px || 1) * Math.sign(pz || 1);
            q.setFromAxisAngle(up, yaw);
            pos.set(px, y, pz);
            scl.setScalar(s ?? 1);
            placed.push(new THREE.Matrix4().compose(pos, q, scl));
          }
        }
      }
      // 部品ごとに InstancedMesh（部品の変換は頂点に焼き込む）
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        const inst = new THREE.InstancedMesh(geo, mesh.material, placed.length);
        placed.forEach((p, i) => inst.setMatrixAt(i, m4.copy(p)));
        inst.computeBoundingSphere();
        this.group.add(inst);
        this.instanced.push({ mesh: inst, max: placed.length });
      });
      if (g.model === this.fire.model) for (const p of placed) this.addFire(p);
    });
    this.applyDecor(this.decorMul);
  }

  /** 燃えるドラム缶: 橙の点光源と、ブルームで光る炎の芯（揺らぐ） */
  private addFire(at: THREE.Matrix4): void {
    const F = this.fire;
    const c = new THREE.Color(F.color);
    const p = new THREE.Vector3().setFromMatrixPosition(at);
    const light = new THREE.PointLight(c, F.lightIntensity, F.lightRangeM);
    light.position.set(p.x, p.y + F.heightM + 0.3, p.z);
    const glow = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.45, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(F.glowHdr), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.position.set(p.x, p.y + F.heightM + 0.2, p.z);
    this.group.add(light, glow);
    this.fires.push({ light, glow, base: F.lightIntensity, phase: this.fires.length * 1.7 });
  }

  update(timeSec: number): void {
    const k = this.fire.flicker;
    for (const f of this.fires) {
      const n = 1 - k + k * (0.5 + 0.3 * Math.sin(timeSec * 13 + f.phase) + 0.2 * Math.sin(timeSec * 29 + f.phase * 2));
      f.light.intensity = f.base * n;
      f.glow.scale.set(1, 0.8 + 0.4 * n, 1);
    }
  }

  applyDecor(decorMul: number): void {
    this.decorMul = decorMul;
    for (const it of this.instanced) it.mesh.count = Math.max(1, Math.round(it.max * decorMul));
    // 火の点光源は画素ごとの負荷になるので、装飾を減らす画質では消す
    for (const f of this.fires) f.light.visible = f.glow.visible = decorMul >= 1;
  }
}
