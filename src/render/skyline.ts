// 遠景のビル群（three 公式の SkyscraperGenerator。docs/research/graphics-compositing.md「採否」）。
// 書き割りの板の手前に、実ジオメトリの高層ビルを闘技場の周りに輪状に建てる（視差・窓の発光・大気遠近）。
// 起動時に一度だけ生成（1 棟 1 ジオメトリ・1 ドローコール、全棟で 1 マテリアル）。影は落とさない。数は画質の decorMul を掛ける。
import * as THREE from 'three/webgpu';
import { InterpolationSamplingMode, InterpolationSamplingType } from 'three/webgpu';
import { attribute, color, dot, float, floor, fract, hash, length, mix, normalWorldGeometry, positionWorld, select, smoothstep, uv, varying, vec2, vec3 } from 'three/tsl';
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
  // 窓の色: 暖色の室内灯が多め、たまに寒色・ネオン
  const warm = color('#ffb46a');
  const cool = color('#8fc4ff');
  const neonA = color('#ff3fd0');
  const neonB = color('#3ff0ff');
  const winCol = select(h2.lessThan(0.55), warm, select(h2.lessThan(0.8), cool, select(h2.lessThan(0.9), neonA, neonB)));
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
  const wall = color(look.wallColor).mul(shade).mul(tone);
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
      this.group.add(m);
      this.towers.push(m);
    }
  }

  applyDecor(decorMul: number): void {
    const n = Math.round(this.towers.length * decorMul);
    this.towers.forEach((t, i) => (t.visible = i < n));
  }
}
