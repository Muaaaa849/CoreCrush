// 遠景（プランナー生成の画像、art/assets.json）。いちばん奥に夜空の円筒、その手前に街のシルエットの板を 2 層（奥行きで視差）。
// 霧の外（遠すぎて距離の霧で消える）なので霧は掛けず、自前で暗く・彩度を落として「背景の彩度を抑える」（GDD 12.2）。
// 画像が読めない環境では何も出さない（背景色のまま）。
import * as THREE from 'three/webgpu';
import { asin, atan, clamp, color, dot, float, min, mix, normalize, positionLocal, positionWorld, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { loadTexture } from './assets';

export interface BackdropLook {
  haze: string;
  saturation: number;
  sky: { texture: string; radiusM: number; horizonDeg: number; bandDeg: number; horizonColor: string; zenithColor: string; repeat: number; hdr: number };
  layers: { texture: string; radiusM: number; count: number; widthM: number; yM: number; startDeg: number; hdr: number; haze: number }[];
}

/** 彩度を落として暗くし、霞の色へ寄せる */
function grade(rgb: THREE.Node<'vec3'>, sat: number, hdr: number, hazeCol: string, haze: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return mix(mix(vec3(lum), rgb, sat).mul(hdr), color(hazeCol), haze);
}

export class Backdrop {
  readonly group = new THREE.Group();
  private readonly layerMeshes: THREE.InstancedMesh[] = [];

  constructor(private readonly look: BackdropLook) {
    this.group.visible = false;
  }

  async load(renderer: THREE.WebGPURenderer): Promise<void> {
    const L = this.look;
    const sky = await loadTexture(renderer, L.sky.texture);
    if (sky) {
      sky.wrapS = THREE.MirroredRepeatWrapping;
      sky.wrapT = THREE.ClampToEdgeWrapping;
      // 全天のドーム（円筒の上が抜けて黒く見えるのをやめる）。地平線から horizonDeg〜bandDeg に雲の絵、天頂は色のグラデーション
      const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
      const dir = normalize(positionLocal);
      const elev = asin(clamp(dir.y, -1, 1));
      const az = atan(dir.x, dir.z).div(Math.PI * 2).add(0.5);
      const v = elev.sub(THREE.MathUtils.degToRad(L.sky.horizonDeg)).div(THREE.MathUtils.degToRad(L.sky.bandDeg - L.sky.horizonDeg));
      const t = texture(sky, vec2(az.mul(L.sky.repeat), clamp(v, 0.002, 0.998)));
      const clouds = grade(t.rgb, L.saturation, L.sky.hdr, L.haze, float(0));
      const zenith = mix(color(L.sky.horizonColor), color(L.sky.zenithColor), smoothstep(0.6, 1.6, v));
      mat.colorNode = mix(clouds, zenith, smoothstep(0.75, 1.05, v)).mul(smoothstep(-0.25, 0.05, v).mul(0.85).add(0.15));
      const m = new THREE.Mesh(new THREE.SphereGeometry(L.sky.radiusM, 64, 32), mat);
      m.renderOrder = -10;
      m.frustumCulled = false;
      this.group.add(m);
    }
    for (const layer of L.layers) {
      const tex = await loadTexture(renderer, layer.texture);
      if (!tex) continue;
      const img = tex.image as { width: number; height: number };
      const h = (layer.widthM * img.height) / img.width;
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const t = texture(tex);
      // 下のほうほど霞む（地面の霧に溶かす）
      const low = float(1).sub(smoothstep(layer.yM, layer.yM + h * 0.35, positionWorld.y));
      mat.colorNode = grade(t.rgb, L.saturation, layer.hdr, L.haze, min(float(layer.haze).add(low.mul(0.5)), 1));
      mat.opacityNode = t.a;
      mat.alphaTest = 0.02;
      const geo = new THREE.PlaneGeometry(layer.widthM, h);
      const inst = new THREE.InstancedMesh(geo, mat, layer.count);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3(1, 1, 1);
      const pos = new THREE.Vector3();
      for (let i = 0; i < layer.count; i++) {
        const a = THREE.MathUtils.degToRad(layer.startDeg) + (i / layer.count) * Math.PI * 2;
        pos.set(Math.sin(a) * layer.radiusM, layer.yM + h / 2, Math.cos(a) * layer.radiusM);
        // 中心を向く（板の表をコート側へ）
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI);
        // 隣と同じ絵が並ばないように、1 つおきに左右反転
        s.set(i % 2 === 0 ? 1 : -1, 1, 1);
        inst.setMatrixAt(i, m4.compose(pos, q, s));
      }
      inst.renderOrder = -9;
      this.group.add(inst);
      this.layerMeshes.push(inst);
    }
    this.group.visible = true;
  }
}
