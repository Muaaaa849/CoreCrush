// 床（GDD 12.2「濡れた路面は粗さムラでネオンを映す」）。
// CC0 のアスファルト（Poly Haven asphalt_02、KTX2）に、ノイズで水たまりを作る: 水たまりは粗さ低・法線平ら・暗く、映り込みが強い。
// 高画質は平面反射（ReflectorNode、半解像度）でネオン・コア・相手を水たまりに映す。中・低は環境マップだけ。
// 外周のネオンライン（自陣の色）も床のシェーダーで描く（描画回数を増やさない）。
import * as THREE from 'three/webgpu';
import {
  abs, clamp, color, dot, float, fwidth, max, min, mix, mx_fractal_noise_float, normalMap, normalView, positionViewDirection,
  positionWorld, reflector, select, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import type { Balance } from '../sim/balance';

export interface FloorLook {
  tileM: number;
  albedoMul: number;
  tint: string;
  roughnessMul: number;
  roughnessMin: number;
  metalness: number;
  normalScale: number;
  puddleScale: number;
  puddleCoverage: number;
  puddleSoftness: number;
  puddleDarken: number;
  grimeScale: number;
  grimeAmount: number;
  reflectPuddle: number;
  reflectDry: number;
  reflectDistortion: number;
  /** 平面反射の解像度（描画解像度に対する倍率） */
  reflectResolution: number;
  /** コートの塗装（白線・中央の円・陣地の円、剥げ）。光らない普通の塗料 */
  paint: { color: string; widthM: number; insetM: number; circleM: number; zoneCircleM: number; wear: number; albedo: number };
  /** タイリングを崩す 2 枚目の縮尺（1 枚目に対する倍率） */
  macroScale: number;
}

/** 読み込み前の代わり（1×1）。読めたら value を差し替える */
function placeholder(r: number, g: number, b: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

export class Floor {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshStandardNodeMaterial;
  private readonly diff = texture(placeholder(90, 90, 96));
  private readonly nor = texture(placeholder(128, 128, 255));
  private readonly rough = texture(placeholder(200, 200, 200));
  private readonly baseEmissive: THREE.Node<'vec3'>;
  private readonly reflectEmissive: THREE.Node<'vec3'> | null;
  private reflectOn = false;
  private macro: ReturnType<typeof texture> | null = null;

  constructor(b: Balance, L: FloorLook, lines: { widthM: number; hdr: number }, playerColors: readonly [number, number], extentM: number) {
    const W = b.court.widthM;
    const D = b.court.depthM;
    const p = positionWorld.xz;
    const uv = p.div(L.tileM);
    this.diff.uvNode = uv;
    this.nor.uvNode = uv;
    this.rough.uvNode = uv;

    // 水たまり（大きめの形）と汚れ（色のムラ）
    const n = mx_fractal_noise_float(vec3(p.mul(L.puddleScale), 0), 4, 2, 0.5);
    const puddle = smoothstep(L.puddleCoverage, L.puddleCoverage + L.puddleSoftness, n.negate());
    const grime = mx_fractal_noise_float(vec3(p.mul(L.grimeScale), 3.7), 3, 2, 0.5).mul(L.grimeAmount).add(1);

    const mat = new THREE.MeshStandardNodeMaterial({ metalness: L.metalness });
    // 同じテクスチャを別の縮尺で重ねて繰り返しを崩す
    const macro = texture(this.diff.value, uv.mul(L.macroScale).add(vec2(0.37, 0.71)));
    this.macro = macro;
    const albedo = this.diff.rgb.mul(macro.r.mul(1.1).add(0.45)).mul(color(L.tint)).mul(L.albedoMul).mul(grime);
    // コートの塗装: 内側の白線、中央の円、各陣地の円。剥げはノイズで
    const P = L.paint;
    const pw = float(P.widthM * 0.5);
    const inX = abs(abs(positionWorld.x).sub(W / 2 - P.insetM));
    const inZ = abs(abs(positionWorld.z).sub(D - P.insetM));
    const box = min(select(abs(positionWorld.z).lessThan(D - P.insetM + P.widthM), inX, float(1e3)), select(abs(positionWorld.x).lessThan(W / 2 - P.insetM + P.widthM), inZ, float(1e3)));
    const circ = abs(p.length().sub(P.circleM));
    const zone = abs(vec2(positionWorld.x, abs(positionWorld.z).sub(D / 2)).length().sub(P.zoneCircleM));
    const pd = min(min(box, circ), zone);
    const paa = max(fwidth(pd), 1e-4);
    const wearN = mx_fractal_noise_float(vec3(p.mul(1.7), 9.1), 3, 2, 0.5);
    const paintMask = float(1).sub(smoothstep(pw.sub(paa), pw.add(paa), pd)).mul(smoothstep(P.wear - 0.15, P.wear + 0.15, wearN.add(0.5)));
    const dryCol = mix(albedo, color(P.color).mul(P.albedo).mul(grime), paintMask);
    mat.colorNode = mix(dryCol, dryCol.mul(L.puddleDarken), puddle);
    mat.roughnessNode = mix(mix(this.rough.r.mul(L.roughnessMul), float(0.45), paintMask), float(L.roughnessMin), puddle);
    mat.normalNode = normalMap(this.nor, vec2(mix(float(L.normalScale), float(0.05), puddle)));

    // 外周のネオンライン（自陣の色、fwidth でアンチエイリアス）
    const lw = float(lines.widthM);
    const ax = abs(abs(positionWorld.x).sub(W / 2 - lines.widthM / 2));
    const az = abs(abs(positionWorld.z).sub(D - lines.widthM / 2));
    const lineD = min(select(abs(positionWorld.z).lessThan(D), ax, float(1e3)), select(abs(positionWorld.x).lessThan(W / 2), az, float(1e3)));
    const aa = max(fwidth(lineD), 1e-4);
    const line = float(1).sub(smoothstep(lw.mul(0.5).sub(aa), lw.mul(0.5).add(aa), lineD));
    const sideColor = select(positionWorld.z.lessThan(0), color(playerColors[0]), color(playerColors[1]));
    this.baseEmissive = sideColor.mul(line).mul(lines.hdr);

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(W + extentM, D * 2 + extentM), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;
    this.mat = mat;

    // 平面反射: 水たまりで強く、乾いた所は弱く。斜めから見るほど強い（フレネル）。法線で少し揺らす
    if (L.reflectPuddle > 0) {
      const r = reflector({ resolutionScale: L.reflectResolution });
      // 反射面は床と同じ向き（床のメッシュは水平に回転済みなので、子にすれば回転は要らない）
      this.mesh.add(r.target);
      const nd = this.nor.xy.sub(0.5).mul(L.reflectDistortion).mul(float(1).sub(puddle.mul(0.8)));
      r.uvNode = r.uvNode!.add(nd);
      const fres = float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)).pow(3).mul(0.7).add(0.3);
      const k = mix(float(L.reflectDry), float(L.reflectPuddle), puddle).mul(fres);
      this.reflectEmissive = this.baseEmissive.add(r.rgb.mul(k));
    } else {
      this.reflectEmissive = null;
    }
    this.setReflection(false);
  }

  /** 画質: 平面反射の有無 */
  setReflection(on: boolean): void {
    const want = on && this.reflectEmissive !== null;
    if (want === this.reflectOn && this.mat.emissiveNode) return;
    this.reflectOn = want;
    this.mat.emissiveNode = want ? this.reflectEmissive : this.baseEmissive;
    this.mat.needsUpdate = true;
  }

  setTextures(diff: THREE.Texture | null, nor: THREE.Texture | null, rough: THREE.Texture | null): void {
    if (diff) {
      this.diff.value = diff;
      if (this.macro) this.macro.value = diff;
    }
    if (nor) this.nor.value = nor;
    if (rough) this.rough.value = rough;
  }
}
