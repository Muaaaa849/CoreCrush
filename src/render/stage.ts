// ステージ（M3 手順3。GDD 1 章「電磁フェンスの違法賭博闘技場」、12.2 の画づくり）。
// 濡れた床（粗さムラ）＋床に描いたネオンのライン、補色のエリアライト（マゼンタ・シアン）、影を落とす主光源 1 灯、
// 地面に溜まる霧、コート外周の金網、観客（InstancedMesh）、遠景（生成画像の板、backdrop.ts）。床は floor.ts。
// 光らせない物は HDR 輝度 1 未満（ブルームのしきい値、ADR 0005）。コアより明るい物は置かない。
import * as THREE from 'three/webgpu';
import {
  abs, clamp, color, float, fog, fract, fwidth, max, min, mix, positionWorld, rangeFogFactor, smoothstep, vec2,
} from 'three/tsl';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import type { Balance } from '../sim/balance';
import type { QualityPreset } from './quality';
import { Floor, type FloorLook } from './floor';
import { Backdrop, type BackdropLook } from './backdrop';
import { loadTexture } from './assets';
import { Props, type FireLook, type PropGroup } from './props';
import { buildPost, buildTruss } from './csgParts';
import { Skyline, type SkylineLook } from './skyline';

type Vec3 = [number, number, number];
export interface StageLook {
  background: string;
  fog: { color: string; nearM: number; farM: number; groundHeightM: number; groundDensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number; posM: Vec3 };
  areaLights: { color: string; intensity: number; widthM: number; heightM: number; posM: Vec3; lookAtM: Vec3 }[];
  env: { intensity: number; panelHdr: number };
  floor: FloorLook;
  backdrop: BackdropLook;
  skyline: SkylineLook;
  charFill: { color: string; intensity: number; rangeM: number; upM: number };
  markers: { ringInnerM: number; ringOuterM: number; hdr: number; opacity: number };
  truss: { spansXM: number[]; lengthM: number; yM: number; sizeM: number; color: string; lensHdr: number; lensColor: string };
  floods: { color: string; intensity: number; angleDeg: number; penumbra: number; decay: number; rangeM: number; heightM: number; items: [number, number, number, number][] };
  props: PropGroup[];
  fire: FireLook;
  fighter: { paintBase: string; paintMix: number; paintRoughness: number; paintMetalness: number; metalColor: string; metalRoughness: number; suitColor: string; glowHdr: number };
  lines: { widthM: number; hdr: number };
  cage: { color: string; heightM: number; cellM: number; wireFrac: number; opacity: number; marginM: number; postColor: string; postSpacingM: number };
  opponentRim: { hdr: number; power: number; lightIntensity: number; lightRangeM: number; lightUpM: number };
  crowd: { count: number; color: string; rowsM: number[]; heightM: [number, number] };
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
  private readonly floor: Floor;
  private readonly backdrop: Backdrop;
  private readonly props: Props;
  private readonly skyline: Skyline;
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

    // --- 投光器（キーライト。床に光だまりを作る。影は主光源だけ） ---
    const FL = L.floods;
    for (const [x, z, tx, tz] of FL.items) {
      const l = new THREE.SpotLight(new THREE.Color(FL.color), FL.intensity, FL.rangeM, THREE.MathUtils.degToRad(FL.angleDeg), FL.penumbra, FL.decay);
      l.position.set(x, FL.heightM, z);
      l.target.position.set(tx, 0, tz);
      l.castShadow = false;
      scene.add(l, l.target);
    }
    const T = L.truss;
    const tg = buildTruss(T.spansXM, T.lengthM, T.yM, T.sizeM, FL.items.map(([x, z, tx, tz]) => [x, z, tx, tz] as [number, number, number, number]));
    const trussMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(T.color), roughness: 0.45, metalness: 0.85 });
    const frame = new THREE.Mesh(tg.frame, trussMat);
    frame.castShadow = true;
    const housing = new THREE.Mesh(tg.housing, trussMat);
    const lens = new THREE.Mesh(tg.lens, new THREE.MeshBasicMaterial({ color: new THREE.Color(T.lensColor).multiplyScalar(T.lensHdr), side: THREE.DoubleSide }));
    scene.add(frame, housing, lens);

    // --- 床（CC0 アスファルト＋水たまり＋平面反射。src/render/floor.ts） ---
    this.floor = new Floor(b, L.floor, L.lines, playerColors, 24);
    scene.add(this.floor.mesh);

    // --- 遠景（プランナー生成の画像。読み込めたら表示） ---
    this.backdrop = new Backdrop(L.backdrop);
    scene.add(this.backdrop.group);
    this.skyline = new Skyline(L.skyline);
    scene.add(this.skyline.group);

    // --- コート外周の小物（CC0 モデル。読み込めたら表示） ---
    this.props = new Props(L.props, L.fire);
    scene.add(this.props.group);

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
    const postMesh = new THREE.InstancedMesh(buildPost(0.16, C.heightM), new THREE.MeshStandardMaterial({ color: new THREE.Color(C.postColor), roughness: 0.6, metalness: 0.7 }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m.makeTranslation(x, 0, z)));
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

  }

  /** テクスチャ（KTX2）を読み込んで差し替える。読めなくても手続き的な見た目で続く */
  async loadAssets(renderer: THREE.WebGPURenderer): Promise<void> {
    const [diff, nor, rough] = await Promise.all([
      loadTexture(renderer, 'asphalt02_diff', { repeat: true }),
      loadTexture(renderer, 'asphalt02_nor', { repeat: true }),
      loadTexture(renderer, 'asphalt02_rough', { repeat: true }),
    ]);
    this.floor.setTextures(diff, nor, rough);
    await this.backdrop.load(renderer);
    await this.props.load(renderer);
  }

  /** 毎フレーム（火の揺らぎなど） */
  update(timeSec: number): void {
    this.props.update(timeSec);
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
    this.floor.setReflection(q.floorReflection);
    this.props.applyDecor(q.decorMul);
    this.skyline.applyDecor(q.decorMul);
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
