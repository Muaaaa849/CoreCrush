// three-bvh-csg（ブーリアン）で組む緻密な形（docs/research/graphics-compositing.md「採否」）。
// 起動時に一度だけ組んで BufferGeometry を返す（試合中には作らない）。マテリアルは呼び出し側。
// 形の寸法は見た目だけの比率（sim の当たり判定は balance.json の半径・高さのまま）。
import * as THREE from 'three/webgpu';
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal'];

function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  // CSG は全ブラシで同じ属性を要る。uv は使わない（手続き的な見た目）
  g.deleteAttribute('uv');
  return g;
}

function brush(g: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Brush {
  const b = new Brush(prep(g));
  b.position.set(...pos);
  b.rotation.set(...rot);
  b.scale.set(...scale);
  b.updateMatrixWorld();
  return b;
}

const box = (w: number, h: number, d: number, pos?: V3, rot?: V3) => brush(new THREE.BoxGeometry(w, h, d), pos, rot);
const sphere = (r: number, pos?: V3, scale?: V3, seg = 20) => brush(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.6)), pos, [0, 0, 0], scale);
const cyl = (r: number, h: number, pos?: V3, rot?: V3, seg = 16) => brush(new THREE.CylinderGeometry(r, r, h, seg), pos, rot);

function op(a: Brush, b: Brush, kind: typeof ADDITION | typeof SUBTRACTION | typeof INTERSECTION): Brush {
  const r = evaluator.evaluate(a, b, kind);
  r.updateMatrixWorld();
  return r;
}

/** 角を 45° で落とした箱（箱 ∩ 45° 回した箱） */
function chamferBox(w: number, h: number, d: number, c: number, pos: V3 = [0, 0, 0]): Brush {
  const a = box(w, h, d, pos);
  const diag = (w + d) / Math.SQRT2 - c * Math.SQRT2;
  const b = brush(new THREE.BoxGeometry(diag, h * 1.01, diag), pos, [0, Math.PI / 4, 0]);
  return op(a, b, INTERSECTION);
}

function geom(b: Brush): THREE.BufferGeometry {
  const g = b.geometry.clone();
  g.applyMatrix4(b.matrixWorld);
  return g;
}

function nonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  return n;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(nonIndexed))!;
}

export interface FighterGeometry {
  /** 塗装した装甲（チーム色の塗り） */
  paint: THREE.BufferGeometry;
  /** 金属の地（暗いガンメタル） */
  metal: THREE.BufferGeometry;
  /** 下に着るスーツ（つや消しのゴム） */
  suit: THREE.BufferGeometry;
  /** 発光ライン（バイザー・背中のコアの輪・脇のライン） */
  glow: THREE.BufferGeometry;
}

/**
 * 仮の選手モデル（箱のプレースホルダーの置き換え。M4 の本番モデルまで）。足元が原点、+z が正面。
 * 装甲は CSG で面取り・溝・通気口・背中のコアの穴を刻む。
 */
export function buildFighter(height: number): FighterGeometry {
  const k = height / 1.8;
  const S = (v: number) => v * k;
  const metal: THREE.BufferGeometry[] = [];
  const paint: THREE.BufferGeometry[] = [];
  const suit: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];

  // --- 胴: 面取りした箱 ∩ 楕円体で丸み、背中に横溝 3 本と縦の背骨溝、背中のコアの穴 ---
  let torso = chamferBox(S(0.46), S(0.5), S(0.3), S(0.07), [0, S(1.27), 0]);
  torso = op(torso, sphere(S(0.36), [0, S(1.24), 0], [1, 1.05, 0.62], 28), INTERSECTION);
  for (let i = 0; i < 3; i++) torso = op(torso, box(S(0.5), S(0.012), S(0.03), [0, S(1.1 + i * 0.06), S(-0.15)]), SUBTRACTION);
  torso = op(torso, box(S(0.02), S(0.4), S(0.04), [0, S(1.3), S(0.16)]), SUBTRACTION);
  paint.push(geom(torso));
  // 腹のスーツ
  suit.push(geom(cyl(S(0.15), S(0.2), [0, S(1.0), 0], [0, 0, 0], 18)));

  // --- 背中のコア・ハウジング（装置の箱から丸い穴、通気口のスリット） ---
  let pack = chamferBox(S(0.3), S(0.34), S(0.12), S(0.035), [0, S(1.3), S(-0.17)]);
  pack = op(pack, cyl(S(0.085), S(0.2), [0, S(1.34), S(-0.2)], [Math.PI / 2, 0, 0], 24), SUBTRACTION);
  for (let i = 0; i < 4; i++) pack = op(pack, box(S(0.018), S(0.07), S(0.1), [S(-0.09 + i * 0.06), S(1.19), S(-0.23)]), SUBTRACTION);
  metal.push(geom(pack));
  // コアの輪（穴の奥で光る輪。中は暗い）
  glow.push(geom(brush(new THREE.TorusGeometry(S(0.068), S(0.012), 8, 32), [0, S(1.34), S(-0.2)])));
  metal.push(geom(cyl(S(0.05), S(0.03), [0, S(1.34), S(-0.19)], [Math.PI / 2, 0, 0], 20)));

  // --- 骨盤・腰 ---
  const hips = chamferBox(S(0.34), S(0.16), S(0.22), S(0.05), [0, S(0.9), 0]);
  metal.push(geom(hips));

  // --- 頭: ヘルメット（球 ∩ 箱）からバイザーの溝を切り、中に光る板 ---
  let helm = sphere(S(0.135), [0, S(1.66), 0], [0.92, 1.05, 1], 24);
  helm = op(helm, box(S(0.3), S(0.3), S(0.3), [0, S(1.66), S(0.02)]), INTERSECTION);
  helm = op(helm, box(S(0.24), S(0.05), S(0.12), [0, S(1.665), S(0.1)]), SUBTRACTION);
  helm = op(helm, box(S(0.012), S(0.14), S(0.08), [0, S(1.74), S(-0.08)], [0.6, 0, 0]), SUBTRACTION);
  paint.push(geom(helm));
  glow.push(geom(box(S(0.2), S(0.03), S(0.04), [0, S(1.665), S(0.085)])));
  suit.push(geom(cyl(S(0.06), S(0.12), [0, S(1.5), 0])));

  for (const sx of [-1, 1]) {
    // 肩当て（球の上半分 ∩、縁に溝）
    let pad = sphere(S(0.13), [sx * S(0.3), S(1.44), 0], [1, 0.8, 1.05], 20);
    pad = op(pad, box(S(0.3), S(0.2), S(0.32), [sx * S(0.3), S(1.52), 0]), INTERSECTION);
    pad = op(pad, box(S(0.3), S(0.01), S(0.4), [sx * S(0.3), S(1.47), 0]), SUBTRACTION);
    paint.push(geom(pad));
    // 腕（上腕・前腕はスーツ、前腕に面取りした籠手）
    suit.push(geom(brush(new THREE.CapsuleGeometry(S(0.055), S(0.26), 4, 12), [sx * S(0.31), S(1.24), 0])));
    suit.push(geom(brush(new THREE.CapsuleGeometry(S(0.05), S(0.24), 4, 12), [sx * S(0.33), S(0.93), S(0.03)], [0.15, 0, 0])));
    let bracer = chamferBox(S(0.12), S(0.2), S(0.12), S(0.03), [sx * S(0.33), S(0.95), S(0.03)]);
    bracer = op(bracer, box(S(0.14), S(0.012), S(0.14), [sx * S(0.33), S(0.98), S(0.03)]), SUBTRACTION);
    metal.push(geom(bracer));
    glow.push(geom(box(S(0.006), S(0.14), S(0.02), [sx * S(0.395), S(0.95), S(0.03)])));
    // 手
    metal.push(geom(sphere(S(0.055), [sx * S(0.34), S(0.78), S(0.04)], [1, 1.2, 1], 12)));
    // 脚（太腿・脛はスーツ、膝当てと脛当て、ブーツ）
    suit.push(geom(brush(new THREE.CapsuleGeometry(S(0.085), S(0.32), 4, 12), [sx * S(0.11), S(0.62), 0])));
    suit.push(geom(brush(new THREE.CapsuleGeometry(S(0.07), S(0.3), 4, 12), [sx * S(0.11), S(0.27), 0])));
    let knee = sphere(S(0.075), [sx * S(0.11), S(0.44), S(0.05)], [1, 1.1, 0.8], 16);
    knee = op(knee, box(S(0.2), S(0.2), S(0.1), [sx * S(0.11), S(0.44), S(0.1)]), INTERSECTION);
    paint.push(geom(knee));
    let shin = chamferBox(S(0.13), S(0.24), S(0.1), S(0.03), [sx * S(0.11), S(0.27), S(0.035)]);
    shin = op(shin, box(S(0.02), S(0.2), S(0.05), [sx * S(0.11), S(0.27), S(0.09)]), SUBTRACTION);
    metal.push(geom(shin));
    let boot = chamferBox(S(0.13), S(0.1), S(0.26), S(0.03), [sx * S(0.11), S(0.05), S(0.03)]);
    boot = op(boot, box(S(0.15), S(0.012), S(0.3), [sx * S(0.11), S(0.03), S(0.03)]), SUBTRACTION);
    metal.push(geom(boot));
    // 脇腹の発光ライン
    glow.push(geom(box(S(0.008), S(0.26), S(0.05), [sx * S(0.225), S(1.26), S(0.02)])));
    // 太腿の外の発光ライン
    glow.push(geom(box(S(0.006), S(0.2), S(0.03), [sx * S(0.193), S(0.64), 0])));
  }
  const out = { paint: merge(paint), metal: merge(metal), suit: merge(suit), glow: merge(glow) };
  for (const g of Object.values(out)) {
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }
  return out;
}

/** 支柱: 面取りした角柱に通気口のスリットとリベット穴、上下に帯（1 ジオメトリ。InstancedMesh で並べる） */
export function buildPost(width: number, height: number): THREE.BufferGeometry {
  const w = width;
  let p = chamferBox(w, height, w, w * 0.22, [0, height / 2, 0]);
  // 正面・背面の縦スリット（通気口）
  for (let i = 0; i < 5; i++) {
    const y = height * 0.25 + i * w * 0.5;
    p = op(p, box(w * 0.5, w * 0.16, w * 1.2, [0, y, 0]), SUBTRACTION);
  }
  // 側面のリベット穴
  for (const y of [0.12, 0.5, 0.88]) {
    for (const s of [-1, 1]) p = op(p, cyl(w * 0.06, w * 0.3, [s * w * 0.5, height * y, 0], [0, 0, Math.PI / 2], 10), SUBTRACTION);
  }
  // 足元の台座（太い面取り箱）
  p = op(p, chamferBox(w * 1.5, w * 0.6, w * 1.5, w * 0.3, [0, w * 0.3, 0]), ADDITION);
  const g = geom(p);
  g.computeBoundingSphere();
  return g;
}

/** I 形鋼の弦材（箱から両脇の溝を引く）。長さ方向は z */
function iBeam(w: number, h: number, len: number, pos: V3): THREE.BufferGeometry {
  let b = box(w, h, len, pos);
  const web = w * 0.22;
  const flange = h * 0.16;
  for (const s of [-1, 1]) b = op(b, box((w - web) / 2, h - flange * 2, len * 1.01, [pos[0] + s * (web / 2 + (w - web) / 4), pos[1], pos[2]]), SUBTRACTION);
  return geom(b);
}

export interface TrussGeometry {
  frame: THREE.BufferGeometry;
  /** 投光器の筐体（中空の筒に放熱フィン） */
  housing: THREE.BufferGeometry;
  /** 投光器のレンズ（発光） */
  lens: THREE.BufferGeometry;
}

/**
 * 天井の照明トラス: 長さ方向（z）に伸びる箱形トラス 2 本＋横つなぎ、投光器の筐体。
 * spans: 各トラスの x（m）。lights: [x, z, 狙う x, 狙う z]（投光器の位置と向き）。
 */
export function buildTruss(spans: number[], lengthM: number, yM: number, sizeM: number, lights: [number, number, number, number][]): TrussGeometry {
  const frame: THREE.BufferGeometry[] = [];
  const s = sizeM;
  const chord = s * 0.14;
  const half = lengthM / 2;
  const bay = s * 1.2;
  const strut = (a: THREE.Vector3, b: THREE.Vector3, t: number) => {
    const d = b.clone().sub(a);
    const g = new THREE.BoxGeometry(t, t, d.length());
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    return g;
  };
  for (const x of spans) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) frame.push(iBeam(chord, chord, lengthM, [x + (sx * s) / 2, yM + (sy * s) / 2, 0]));
    // 斜材（2 側面と上下）
    const n = Math.floor(lengthM / bay);
    for (let i = 0; i < n; i++) {
      const z0 = -half + i * bay;
      const z1 = z0 + bay;
      const flip = i % 2 === 0;
      for (const sx of [-1, 1]) {
        const xx = x + (sx * s) / 2;
        frame.push(strut(new THREE.Vector3(xx, yM - s / 2, flip ? z0 : z1), new THREE.Vector3(xx, yM + s / 2, flip ? z1 : z0), chord * 0.45));
      }
      for (const sy of [-1, 1]) {
        const yy = yM + (sy * s) / 2;
        frame.push(strut(new THREE.Vector3(x - s / 2, yy, flip ? z0 : z1), new THREE.Vector3(x + s / 2, yy, flip ? z1 : z0), chord * 0.4));
      }
    }
  }
  // 横つなぎ（両端と中央）
  if (spans.length > 1) {
    const x0 = Math.min(...spans);
    const x1 = Math.max(...spans);
    for (const z of [-half + s / 2, 0, half - s / 2]) {
      for (const sy of [-1, 1]) {
        const g = new THREE.BoxGeometry(x1 - x0, chord, chord);
        g.deleteAttribute('uv');
        g.translate((x0 + x1) / 2, yM + (sy * s) / 2, z);
        frame.push(g);
      }
    }
  }
  // 投光器: 筒 − 内側の筒（中空）＋背面のフィン、トラスの下に吊る
  const housing: THREE.BufferGeometry[] = [];
  const lens: THREE.BufferGeometry[] = [];
  const r = s * 0.42;
  for (const [x, z, tx, tz] of lights) {
    const hy = yM - s / 2 - r * 1.1;
    let can = cyl(r, r * 1.6, [0, 0, 0], [0, 0, 0], 20);
    can = op(can, cyl(r * 0.82, r * 1.2, [0, -r * 0.45, 0], [0, 0, 0], 20), SUBTRACTION);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      can = op(can, box(r * 2.6, r * 0.12, r * 0.06, [0, r * 0.65, 0], [0, a, 0]), ADDITION);
    }
    // 下向き（-y）が光の向き。狙う点へ傾ける
    const dir = new THREE.Vector3(tx - x, -hy, tz - z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, hy, z), q, new THREE.Vector3(1, 1, 1));
    housing.push(geom(can).applyMatrix4(m));
    const l = new THREE.CircleGeometry(r * 0.8, 20);
    l.deleteAttribute('uv');
    l.rotateX(Math.PI / 2);
    l.translate(0, -r * 0.55, 0);
    lens.push(l.applyMatrix4(m));
    // 吊り金具
    const g = new THREE.BoxGeometry(chord * 0.5, yM - s / 2 - hy, chord * 0.5);
    g.deleteAttribute('uv');
    g.translate(x, (yM - s / 2 + hy) / 2, z);
    frame.push(g);
  }
  const out = { frame: merge(frame), housing: merge(housing), lens: merge(lens) };
  for (const g of Object.values(out)) g.computeBoundingSphere();
  return out;
}
