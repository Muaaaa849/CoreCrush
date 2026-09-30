// ステージ（M3 手順3。GDD 1 章「電磁フェンスの違法賭博闘技場」、12.2 の画づくり）。
// 濡れた床（粗さムラ）＋床に描いたネオンのライン、補色のエリアライト（マゼンタ・シアン）、影を落とす主光源 1 灯、
// 地面に溜まる霧、コート外周の金網、観客・遠景のビル・看板（InstancedMesh）。
// 光らせない物は HDR 輝度 1 未満（ブルームのしきい値、ADR 0005）。コアより明るい物は置かない。
import * as THREE from 'three/webgpu';
import {
  abs, clamp, color, float, fog, fract, fwidth, max, min, mix, mx_fractal_noise_float, positionWorld, rangeFogFactor, select, smoothstep, vec2, vec3,
} from 'three/tsl';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import type { Balance } from '../sim/balance';
import type { QualityPreset } from './quality';

type Vec3 = [number, number, number];
export interface StageLook {
  background: string;
  fog: { color: string; nearM: number; farM: number; groundHeightM: number; groundDensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number; posM: Vec3 };
  areaLights: { color: string; intensity: number; widthM: number; heightM: number; posM: Vec3; lookAtM: Vec3 }[];
  env: { intensity: number; panelHdr: number };
  floor: { color: string; puddleColor: string; roughnessMin: number; roughnessMax: number; metalness: number; noiseScale: number; puddleCoverage: number };
  lines: { widthM: number; hdr: number };
  cage: { color: string; heightM: number; cellM: number; wireFrac: number; opacity: number; marginM: number; postColor: string; postSpacingM: number };
  opponentRim: { hdr: number; power: number };
  crowd: { count: number; color: string; rowsM: number[]; heightM: [number, number] };
  skyline: { count: number; color: string; windowHdr: number; radiusM: [number, number]; heightM: [number, number] };
  signs: { count: number; hdr: number; saturation: number };
}

/** 装飾の配置用の決まった乱数（毎回同じ並びにする。sim の RNG とは無関係） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let ltcReady = false;

export class Stage {
  readonly sun: THREE.DirectionalLight;
  private readonly crowd: THREE.InstancedMesh;
  private readonly crowdMax: number;
  private readonly skyline: THREE.InstancedMesh;
  private readonly skylineMax: number;
  private readonly signs: THREE.InstancedMesh;
  private readonly signsMax: number;
  private env: THREE.RenderTarget | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    b: Balance,
    private readonly look: StageLook,
    playerColors: readonly [number, number],
  ) {
    if (!ltcReady) {
      THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
      ltcReady = true;
    }
    const W = b.court.widthM;
    const D = b.court.depthM;
    const L = look;
    scene.background = new THREE.Color(L.background);

    // --- 霧: 距離の霧＋地面に溜まる霧（高さで薄くなる） ---
    const fogColor = color(L.fog.color);
    const dist = rangeFogFactor(L.fog.nearM, L.fog.farM);
    const ground = float(1).sub(smoothstep(0, L.fog.groundHeightM, positionWorld.y)).mul(L.fog.groundDensity).mul(smoothstep(W * 0.5, W * 1.5, positionWorld.xz.length()));
    (scene as unknown as { fogNode: unknown }).fogNode = fog(fogColor, max(dist, ground));

    // --- 光 ---
    scene.add(new THREE.HemisphereLight(new THREE.Color(L.hemi.sky), new THREE.Color(L.hemi.ground), L.hemi.intensity));
    this.sun = new THREE.DirectionalLight(new THREE.Color(L.sun.color), L.sun.intensity);
    this.sun.position.set(...L.sun.posM);
    const sc = this.sun.shadow.camera;
    sc.left = -W / 2 - 2;
    sc.right = W / 2 + 2;
    sc.top = D + 2;
    sc.bottom = -D - 2;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);
    for (const a of L.areaLights) {
      const l = new THREE.RectAreaLight(new THREE.Color(a.color), a.intensity, a.widthM, a.heightM);
      l.position.set(...a.posM);
      l.lookAt(...a.lookAtM);
      scene.add(l);
    }

    // --- 床: 粗さムラ（水たまり）＋ネオンのライン ---
    const F = L.floor;
    const floorMat = new THREE.MeshStandardNodeMaterial({ metalness: F.metalness });
    const p = positionWorld.xz;
    const n = mx_fractal_noise_float(vec3(p.mul(F.noiseScale), 0), 4, 2, 0.5);
    const puddle = smoothstep(F.puddleCoverage - 0.6, F.puddleCoverage - 0.2, n.mul(-1));
    floorMat.colorNode = mix(color(F.color), color(F.puddleColor), puddle);
    floorMat.roughnessNode = mix(float(F.roughnessMax), float(F.roughnessMin), puddle);
    // ライン: 外周（サイドライン・エンドライン）。自陣の色で、アンチエイリアスは fwidth で
    const lw = float(L.lines.widthM);
    const ax = abs(abs(positionWorld.x).sub(W / 2 - L.lines.widthM / 2));
    const az = abs(abs(positionWorld.z).sub(D - L.lines.widthM / 2));
    const lineD = min(select(abs(positionWorld.z).lessThan(D), ax, float(1e3)), select(abs(positionWorld.x).lessThan(W / 2), az, float(1e3)));
    const aa = max(fwidth(lineD), 1e-4);
    const line = float(1).sub(smoothstep(lw.mul(0.5).sub(aa), lw.mul(0.5).add(aa), lineD));
    const sideColor = select(positionWorld.z.lessThan(0), color(playerColors[0]), color(playerColors[1]));
    floorMat.emissiveNode = sideColor.mul(line).mul(L.lines.hdr);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 24, D * 2 + 24), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // --- 金網（コート外周。ひし形の網をシェーダーで。遠くは網目の平均の濃さに溶かす） ---
    const C = L.cage;
    const cx = W / 2 + C.marginM;
    const cz = D + C.marginM;
    const cageGeo = cageWalls(cx, cz, C.heightM);
    const cageMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const uv = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y).div(C.cellM);
    const d1 = abs(fract(uv.x.add(uv.y)).sub(0.5));
    const d2 = abs(fract(uv.x.sub(uv.y)).sub(0.5));
    const wireD = min(d1, d2);
    const waa = max(fwidth(wireD), 1e-4);
    const wire = float(1).sub(smoothstep(float(C.wireFrac * 0.5).sub(waa), float(C.wireFrac * 0.5).add(waa), wireD));
    // 網目が画素より細かくなったら平均の被覆率へ
    const avg = float(C.wireFrac * 2);
    const far = clamp(waa.mul(10), 0, 1);
    cageMat.colorNode = color(C.color);
    cageMat.opacityNode = mix(wire, avg, far).mul(C.opacity).mul(float(1).sub(smoothstep(C.heightM * 0.7, C.heightM, positionWorld.y)).mul(0.6).add(0.4));
    scene.add(new THREE.Mesh(cageGeo, cageMat));
    // 支柱（InstancedMesh 1 回）
    const posts: [number, number][] = [];
    for (let x = -cx; x <= cx + 1e-6; x += C.postSpacingM) posts.push([x, -cz], [x, cz]);
    for (let z = -cz + C.postSpacingM; z < cz - 1e-6; z += C.postSpacingM) posts.push([-cx, z], [cx, z]);
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, C.heightM, 0.14), new THREE.MeshStandardMaterial({ color: new THREE.Color(C.postColor), roughness: 0.6, metalness: 0.7 }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m.makeTranslation(x, C.heightM / 2, z)));
    postMesh.castShadow = true;
    scene.add(postMesh);

    const rnd = lcg(0xc0c0);
    // --- 観客（金網の外のシルエット） ---
    const cr = L.crowd;
    this.crowdMax = cr.count;
    this.crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.28, 1, 2, 6), new THREE.MeshStandardMaterial({ color: new THREE.Color(cr.color), roughness: 0.9 }), cr.count);
    for (let i = 0; i < cr.count; i++) {
      const row = cr.rowsM[i % cr.rowsM.length]!;
      const h = cr.heightM[0] + rnd() * (cr.heightM[1] - cr.heightM[0]);
      // 長辺側（左右）に多く、エンド側にも少し
      const onSide = rnd() < 0.7;
      const t = rnd() * 2 - 1;
      const x = onSide ? Math.sign(t || 1) * (cx + row) : t * (cx + row);
      const z = onSide ? (rnd() * 2 - 1) * (cz - 1) : Math.sign(rnd() - 0.5) * (cz + row);
      const s = h / 1.56;
      m.makeScale(1, s, 1).setPosition(x, (h / 2) * 1.0, z);
      this.crowd.setMatrixAt(i, m);
    }
    scene.add(this.crowd);

    // --- 遠景のビル（暗く彩度を落とす。窓はノイズで点灯。しきい値未満） ---
    const sk = L.skyline;
    this.skylineMax = sk.count;
    const skyMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(sk.color), roughness: 0.8 });
    const wx = fract(positionWorld.x.add(positionWorld.z).mul(1.1));
    const wy = fract(positionWorld.y.mul(0.6));
    const win = smoothstep(0.3, 0.35, wx).mul(float(1).sub(smoothstep(0.65, 0.7, wx))).mul(smoothstep(0.3, 0.4, wy)).mul(float(1).sub(smoothstep(0.6, 0.7, wy)));
    const lit = smoothstep(0.1, 0.35, mx_fractal_noise_float(positionWorld.mul(0.08), 2, 2, 0.5));
    skyMat.emissiveNode = mix(color(0xffb86b), color(0x6be3ff), smoothstep(-0.2, 0.2, mx_fractal_noise_float(positionWorld.mul(0.02), 1, 2, 0.5))).mul(win).mul(lit).mul(sk.windowHdr);
    this.skyline = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), skyMat, sk.count);
    for (let i = 0; i < sk.count; i++) {
      const a = (i / sk.count) * Math.PI * 2 + rnd() * 0.05;
      const r = sk.radiusM[0] + rnd() * (sk.radiusM[1] - sk.radiusM[0]);
      const h = sk.heightM[0] + rnd() * rnd() * (sk.heightM[1] - sk.heightM[0]);
      const w = 6 + rnd() * 10;
      m.makeRotationY(-a).scale(new THREE.Vector3(w, h, 6 + rnd() * 8)).setPosition(Math.cos(a) * r, h / 2, Math.sin(a) * r * 1.3);
      this.skyline.setMatrixAt(i, m);
    }
    scene.add(this.skyline);

    // --- 看板（ビルに貼った発光板。彩度を落としてしきい値未満） ---
    const sg = L.signs;
    this.signsMax = sg.count;
    const signMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    this.signs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), signMat, sg.count);
    const palette = [0xff2bd6, 0x35f2ff, 0xffb86b, 0x9b5bff, 0xff3b6b];
    const col = new THREE.Color();
    const grey = new THREE.Color();
    for (let i = 0; i < sg.count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = sk.radiusM[0] - 4 + rnd() * 10;
      const w = 3 + rnd() * 6;
      const h = w * (0.4 + rnd() * 1.6);
      m.makeRotationY(-a - Math.PI / 2).scale(new THREE.Vector3(w, h, 1)).setPosition(Math.cos(a) * r, 8 + rnd() * 30, Math.sin(a) * r * 1.3);
      this.signs.setMatrixAt(i, m);
      col.setHex(palette[i % palette.length]!);
      grey.setScalar(col.r * 0.3 + col.g * 0.59 + col.b * 0.11);
      this.signs.setColorAt(i, col.lerp(grey, 1 - sg.saturation).multiplyScalar(sg.hdr));
    }
    scene.add(this.signs);
  }

  /** 環境マップ（床に映るネオン）。レンダラーの初期化後に 1 回だけ */
  buildEnvironment(renderer: THREE.WebGPURenderer, playerColors: readonly [number, number]): void {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(this.look.background);
    const hdr = this.look.env.panelHdr;
    const panel = (c: number, x: number, z: number, ry: number, w: number, h: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(hdr), side: THREE.DoubleSide }));
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      envScene.add(mesh);
    };
    panel(playerColors[1], -12, 0, Math.PI / 2, 30, 2, 5);
    panel(playerColors[0], 12, 0, Math.PI / 2, 30, 2, 5);
    panel(0xffb86b, 0, 30, 0, 20, 6, 10);
    panel(0x9b5bff, 0, -30, 0, 20, 6, 10);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.env = pmrem.fromScene(envScene, 0.04);
    pmrem.dispose();
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = this.look.env.intensity;
  }

  /** 画質段階: 影マップ・装飾の量 */
  applyQuality(renderer: THREE.WebGPURenderer, q: QualityPreset): void {
    const shadows = q.shadowMapSize > 0;
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      // 影の有無はシェーダーが変わるので作り直させる
      this.scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => (x.needsUpdate = true));
        else if (mat) mat.needsUpdate = true;
      });
    }
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = shadows;
    if (shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.crowd.count = Math.round(this.crowdMax * q.decorMul);
    this.skyline.count = Math.round(this.skylineMax * Math.max(q.decorMul, 0.5));
    this.signs.count = Math.round(this.signsMax * q.decorMul);
  }
}

/** 金網の壁 4 面（外向き・内向きの両面で描く 1 つのジオメトリ） */
function cageWalls(cx: number, cz: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    pos.push(x0, 0, z0, x1, 0, z1, x1, h, z1, x0, 0, z0, x1, h, z1, x0, h, z0);
  };
  quad(-cx, -cz, cx, -cz);
  quad(cx, -cz, cx, cz);
  quad(cx, cz, -cx, cz);
  quad(-cx, cz, -cx, -cz);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
