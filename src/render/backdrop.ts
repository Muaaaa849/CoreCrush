// 遠景（プランナー生成の画像、art/assets.json）。いちばん奥に夜空の円筒、その手前に街のシルエットの板を 2 層（奥行きで視差）。
// 霧の外（遠すぎて距離の霧で消える）なので霧は掛けず、自前で暗く・彩度を落として「背景の彩度を抑える」（GDD 12.2）。
// 画像が読めない環境では何も出さない（背景色のまま）。
import * as THREE from 'three/webgpu';
import { color, dot, float, min, mix, positionWorld, smoothstep, texture, vec3 } from 'three/tsl';
import { loadTexture } from './assets';

export interface BackdropLook {
  haze: string;
  saturation: number;
  sky: { texture: string; radiusM: number; heightM: number; yM: number; repeat: number; hdr: number };
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
      const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
      const t = texture(sky);
      mat.colorNode = grade(t.rgb, L.saturation, L.sky.hdr, L.haze, float(0));
      const geo = new THREE.CylinderGeometry(L.sky.radiusM, L.sky.radiusM, L.sky.heightM, 48, 1, true);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * L.sky.repeat);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = L.sky.yM + L.sky.heightM / 2;
      // 鏡映しの継ぎ目を正面（相手の方向）から外す
      m.rotation.y = Math.PI / L.sky.repeat;
      m.renderOrder = -10;
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
