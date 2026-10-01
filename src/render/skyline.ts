// 遠景のビル群（three 公式の SkyscraperGenerator。docs/research/graphics-compositing.md「採否」）。
// 書き割りの板の手前に、実ジオメトリの高層ビルを闘技場の周りに輪状に建てる（視差・窓の発光・大気遠近）。
// 起動時に一度だけ生成（1 棟 1 ジオメトリ・1 ドローコール、全棟で 1 マテリアル）。影は落とさない。数は画質の decorMul を掛ける。
import * as THREE from 'three/webgpu';
import { InterpolationSamplingMode, InterpolationSamplingType } from 'three/webgpu';
import { attribute, color, dot, float, floor, fract, hash, length, max, min, mix, normalWorldGeometry, positionWorld, select, sin, smoothstep, time, uv, varying, vec2, vec3 } from 'three/tsl';
import { SkyscraperGenerator } from 'three/addons/generators/city/SkyscraperGenerator.js';

// 生成器が頂点に焼く部位の番号（SkyscraperGenerator.js の PartId）
const GLASS = 4;
const SHOPGLASS = 6;
const FRAME = 2;
const PIER = 1;

/**
 * 夜のビルの軽いマテリアル（光の計算なし）。生成器の標準マテリアルは部屋の奥行きをレイマーチし、ノイズも多く、
 * 遠景の広い面積に掛けると重い（ソフトウェア描画では 1 フレーム数十秒）ので、同じ部位番号を読んで自前で塗る。
 * 窓は 1 枚ずつ（roomCenter のハッシュで）点灯・色を決める。壁は面の向きで暗く塗り分ける（月明かりと街の照り返し）。
 */
function nightMaterial(look: SkylineLook): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  const part = varying(attribute('partId', 'float')).setInterpolation(InterpolationSamplingType.FLAT, InterpolationSamplingMode.EITHER);
  const room = varying(attribute('roomCenter', 'vec3')).setInterpolation(InterpolationSamplingType.FLAT, InterpolationSamplingMode.EITHER);
  const isGlass = part.equal(GLASS).or(part.equal(SHOPGLASS));
  const cell = floor(room.mul(2)).add(vec3(4096));
  const h1 = hash(cell.x.mul(73.0).add(cell.y.mul(151.0)).add(cell.z.mul(311.0)));
  const h2 = fract(h1.mul(17.31));
  const h3 = fract(h1.mul(41.77));
  const lit = h1.lessThan(look.litChance);
  // 窓の色: 暖色の室内灯が多め、白・薄い寒色。チーム色（シアン・マゼンタ）は使わない（選手とコアだけの色にして読みやすく）
  const warm = color('#ffb46a');
  const white = color('#fff1dc');
  const cool = color('#b8c8e8');
  const winCol = select(h2.lessThan(0.6), warm, select(h2.lessThan(0.85), white, cool));
  // 部屋の明かり: 窓の中央が明るく縁へ落ちる＋ブラインドの横縞（たまに）
  const d = length(uv().sub(vec2(0.5, 0.55)).mul(vec2(1.2, 1.6)));
  const room2 = smoothstep(0.85, 0.15, d).mul(0.65).add(0.35);
  const blinds = select(h3.greaterThan(0.7), fract(uv().y.mul(9)).step(0.55).mul(0.4).add(0.6), float(1));
  const winLit = winCol.mul(h3.mul(0.6).add(0.4)).mul(room2).mul(blinds).mul(look.windowHdr);
  // 消えた窓は空を映す暗いガラス（上ほど明るい）
  const glassDark = mix(color('#06070c'), color('#161a2a'), smoothstep(0, 200, positionWorld.y));
  const glass = select(lit, winLit, glassDark);
  // 壁: 面の向きで明暗（上面は明るく、側面は向きで差）
  const n = normalWorldGeometry;
  const shade = dot(n, vec3(0.35, 0.8, -0.45)).mul(0.5).add(0.5).mul(0.7).add(0.3);
  const tone = select(part.equal(PIER), float(1.15), select(part.equal(FRAME), float(0.6), float(1)));
  // 下の街明かりの照り返し（足元ほど暖色に明るい）と、上の空の明るさ
  const street = smoothstep(look.baseYM + look.streetGlowM, look.baseYM, positionWorld.y);
  const wall = color(look.wallColor).mul(shade).mul(tone).add(color(look.streetGlowColor).mul(street).mul(n.y.abs().oneMinus()));
  mat.colorNode = select(isGlass, glass, wall);
  return mat;
}

export interface SkylineLook {
  count: number;
  seed: number;
  radiusM: [number, number];
  heightM: [number, number];
  baseYM: number;
  wallColor: string;
  windowHdr: number;
  /** 点いている窓の割合 */
  litChance: number;
  /** 足元の街明かりが外壁を照らす高さ（m）と色 */
  streetGlowM: number;
  streetGlowColor: string;
  /** 闘技場側の面に掛ける LED 看板（チーム色は使わない） */
  signs: { chance: number; colors: string[]; hdr: number; heightM: [number, number] };
  /** 屋上の航空障害灯 */
  beacons: { color: string; hdr: number; sizeM: number };
}

/** LED 看板: 文字のような点の並び（行・字・画素をハッシュで点灯）と枠。色はインスタンス色 */
function signMaterial(look: SkylineLook): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const st = uv();
  const rows = float(2);
  const cols = float(5);
  const seed = floor(positionWorld.x.mul(0.13)).add(floor(positionWorld.z.mul(0.11)).mul(37));
  // 字の格子（行 × 字）、字の中は 5×5 の画素
  const g = st.mul(vec2(cols, rows));
  const ch = floor(g);
  const px = floor(fract(g).mul(vec2(6, 7)));
  const inGlyph = px.x.lessThan(5).and(px.y.lessThan(6)).and(px.y.greaterThan(0));
  const on = hash(ch.x.mul(7).add(ch.y.mul(131)).add(px.x.mul(17)).add(px.y.mul(53)).add(seed)).greaterThan(0.4);
  const lineOn = hash(ch.y.add(seed.mul(3))).greaterThan(0.25);
  const lit = select(inGlyph.and(on).and(lineOn), float(1), float(0.06));
  const border = max(smoothstep(0.03, 0.0, min(st.x, st.y.min(float(1).sub(st.x)).min(float(1).sub(st.y)))), float(0));
  const flick = sin(time.mul(1.3).add(seed)).mul(0.08).add(0.92);
  // 色はインスタンス色（InstanceNode が掛ける）
  mat.colorNode = vec3(max(lit, border)).mul(flick).mul(look.signs.hdr);
  return mat;
}

export class Skyline {
  readonly group = new THREE.Group();
  private readonly towers: THREE.Mesh[] = [];

  constructor(look: SkylineLook) {
    let s = look.seed >>> 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const mat = nightMaterial(look);
    const signs: THREE.Matrix4[] = [];
    const signCols: THREE.Color[] = [];
    const roofs: THREE.Vector3[] = [];
    for (let i = 0; i < look.count; i++) {
      const a = (i + rnd() * 0.6) / look.count * Math.PI * 2;
      const r = look.radiusM[0] + rnd() * (look.radiusM[1] - look.radiusM[0]);
      const h = look.heightM[0] + rnd() * (look.heightM[1] - look.heightM[0]);
      const gen = new SkyscraperGenerator({ seed: Math.floor(rnd() * 1e6), totalHeight: h }, mat);
      const m = gen.build() as THREE.Mesh;
      m.position.set(Math.sin(a) * r, look.baseYM, Math.cos(a) * r);
      // 面を闘技場に向ける（角の面取りが見える向きに少しずらす）
      m.rotation.y = a + Math.PI + (rnd() - 0.5) * 0.6;
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      // 看板と屋上の灯（建物の外形から置く）
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      if (rnd() < look.signs.chance) {
        const sh = look.signs.heightM[0] + rnd() * (look.signs.heightM[1] - look.signs.heightM[0]);
        const sw = (bb.max.x - bb.min.x) * (0.45 + rnd() * 0.35);
        const sy = bb.min.y + (bb.max.y - bb.min.y) * (0.35 + rnd() * 0.4);
        const local = new THREE.Matrix4().compose(new THREE.Vector3((rnd() - 0.5) * 4, sy, bb.max.z + 1.2), new THREE.Quaternion(), new THREE.Vector3(sw, sh, 1));
        signs.push(m.matrix.clone().multiply(local));
        signCols.push(new THREE.Color(look.signs.colors[Math.floor(rnd() * look.signs.colors.length)]!));
      }
      for (const [x, z] of [[bb.min.x, bb.max.z], [bb.max.x, bb.max.z]] as const) {
        roofs.push(new THREE.Vector3(x * 0.92, bb.max.y + 1, z * 0.92).applyMatrix4(m.matrix));
      }
      this.group.add(m);
      this.towers.push(m);
    }
    if (signs.length) {
      const sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), signMaterial(look), signs.length);
      signs.forEach((mm, i) => {
        sm.setMatrixAt(i, mm);
        sm.setColorAt(i, signCols[i]!);
      });
      sm.frustumCulled = false;
      this.group.add(sm);
      this.signs = sm;
    }
    // 航空障害灯（ゆっくり点滅。ブルームで小さくにじむ）
    const B = look.beacons;
    const bm = new THREE.MeshBasicNodeMaterial();
    const ph = hash(floor(positionWorld.x).add(floor(positionWorld.z).mul(13)));
    bm.colorNode = color(B.color).mul(B.hdr).mul(sin(time.mul(2.2).add(ph.mul(6.28))).mul(0.5).add(0.5).pow(3).mul(0.85).add(0.15));
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(B.sizeM, 8, 6), bm, roofs.length);
    const mm = new THREE.Matrix4();
    roofs.forEach((p, i) => lights.setMatrixAt(i, mm.makeTranslation(p.x, p.y, p.z)));
    lights.frustumCulled = false;
    this.group.add(lights);
  }

  private signs: THREE.InstancedMesh | null = null;

  applyDecor(decorMul: number): void {
    const n = Math.round(this.towers.length * decorMul);
    this.towers.forEach((t, i) => (t.visible = i < n));
  }
}
