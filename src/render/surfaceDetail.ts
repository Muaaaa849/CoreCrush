// 手続き的な表面の細部（パネルの継ぎ目・擦れ・粗さのムラ）。テクスチャなしで仮モデルに素材感を足す。
// モデル空間の座標で三面から格子を引く（面と平行な軸の線は出さない）。数値は呼び出し側（data/render.json）。
import * as THREE from 'three/webgpu';
import { abs, float, fract, max, mix, mx_noise_float, normalLocal, positionLocal, smoothstep, vec3 } from 'three/tsl';

export interface SurfaceDetailLook {
  /** 継ぎ目の間隔（x, y, z。m） */
  panelM: [number, number, number];
  /** 継ぎ目の幅（間隔に対する割合） */
  seamFrac: number;
  /** 継ぎ目の暗さ（0〜1） */
  seamDarken: number;
  /** 擦れ・ムラの細かさ（1/m） */
  wearScale: number;
  /** 粗さのムラの量 */
  wearRoughness: number;
}

/** 材質に継ぎ目と擦れを足す（colorNode・roughnessNode を置き換える） */
export function applySurfaceDetail(mat: THREE.MeshStandardNodeMaterial, base: THREE.Color, roughness: number, look: SurfaceDetailLook): void {
  const p = positionLocal.div(vec3(...look.panelM));
  const n = abs(normalLocal);
  const w = float(look.seamFrac);
  const line = (c: THREE.Node<'float'>) => smoothstep(w, w.mul(0.35), abs(fract(c.add(0.5)).sub(0.5)));
  const seam = max(max(line(p.x).mul(float(1).sub(n.x)), line(p.y).mul(float(1).sub(n.y))), line(p.z).mul(float(1).sub(n.z)));
  const wear = mx_noise_float(positionLocal.mul(look.wearScale)).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionLocal.mul(look.wearScale * 6)).mul(0.5).add(0.5);
  const col = vec3(base.r, base.g, base.b).mul(float(1).sub(seam.mul(look.seamDarken))).mul(fine.mul(0.12).add(0.94));
  mat.colorNode = col;
  mat.roughnessNode = mix(float(roughness).add(wear.sub(0.5).mul(look.wearRoughness)), float(0.85), seam).clamp(0.04, 1);
}
