// コアの液晶の顔（GDD 13）。球の画面側に表情アトラスを LCD 風（画素グリッド・走査線・色収差）で出す。
// 顔は常にカメラの方を向く（ビュー空間の法線で貼る）ので、どこから見ても残り時間の表情が読める。
// 表情・色・輝度は data/vfx/coreFace.json、段階の閾値は balance.json の count.faceSec。
import * as THREE from 'three/webgpu';
import {
  abs, color, float, floor, fract, max, min, mix, normalView, smoothstep, step, texture, time, uniform, vec2, vec3,
} from 'three/tsl';
import faceJson from '../../data/vfx/coreFace.json';
import type { FaceStage } from '../render/protoView';

export interface CoreFaceLook {
  gridPx: number;
  faceScale: number;
  faceHdr: number;
  backlightHdr: number;
  heldDim: number;
  scanlineAmount: number;
  scanlineSpeed: number;
  aberrationPx: number;
  blinkPeriodSec: number;
  shell: { color: string; roughness: number; metalness: number };
  light: { intensity: number; rangeM: number };
  colors: Record<FaceStage, string>;
  frames: Record<'smile' | 'nervous' | 'angry' | 'crack', string[]>;
}

export const CORE_FACE: CoreFaceLook = faceJson as CoreFaceLook;

const FRAME_ORDER = ['smile', 'nervous', 'angry', 'crack'] as const;
/** 段階 → アトラスのコマ（点滅は激怒の顔を点滅させる） */
const STAGE_FRAME: Record<FaceStage, number> = { smile: 0, nervous: 1, angry: 2, blink: 2, crack: 3 };

/** 表情の画素絵を 1 枚のテクスチャ（横に並べる）にする */
function buildAtlas(look: CoreFaceLook): THREE.DataTexture {
  const g = look.gridPx;
  const w = g * FRAME_ORDER.length;
  const data = new Uint8Array(w * g * 4);
  FRAME_ORDER.forEach((name, f) => {
    const rows = look.frames[name];
    for (let y = 0; y < g; y++) {
      const row = rows[y] ?? '';
      for (let x = 0; x < g; x++) {
        // テクスチャの行 0 は下。画素絵の行 0（上）を一番上に置く
        const i = ((g - 1 - y) * w + f * g + x) * 4;
        const on = row[x] === '#' ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = on;
        data[i + 3] = 255;
      }
    }
  });
  const t = new THREE.DataTexture(data, w, g, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class CoreFace {
  readonly material: THREE.MeshStandardNodeMaterial;
  readonly light: THREE.PointLight;
  private readonly frame = uniform(0);
  private readonly faceColor = uniform(new THREE.Color());
  /** 全体の明るさ（所持中・点滅の消灯で下げる） */
  private readonly dim = uniform(1);
  private readonly colors: Record<FaceStage, THREE.Color>;

  constructor(private readonly look: CoreFaceLook = CORE_FACE) {
    const L = look;
    const g = L.gridPx;
    const atlas = buildAtlas(L);
    this.colors = {} as Record<FaceStage, THREE.Color>;
    for (const k of Object.keys(L.colors) as FaceStage[]) this.colors[k] = new THREE.Color(L.colors[k]);

    const mat = new THREE.MeshStandardNodeMaterial({ roughness: L.shell.roughness, metalness: L.shell.metalness });
    mat.colorNode = color(L.shell.color);
    // 顔の座標: ビュー空間の法線の xy（カメラ正面が中央）
    const n = normalView;
    const fuv = n.xy.mul(L.faceScale * 0.5).add(0.5);
    const inside = step(0, fuv.x).mul(step(fuv.x, 1)).mul(step(0, fuv.y)).mul(step(fuv.y, 1)).mul(step(0, n.z));
    const pc = fuv.mul(g);
    const sample = (dx: number) => {
      const p = floor(pc.add(vec2(dx, 0)));
      const px = min(max(p.x, 0), g - 1);
      const py = min(max(p.y, 0), g - 1);
      return texture(atlas, vec2(px.add(this.frame.mul(g)).add(0.5).div(g * FRAME_ORDER.length), py.add(0.5).div(g))).r;
    };
    // 色収差: 赤と青を少しずらして読む
    const a = L.aberrationPx;
    const faceRgb = vec3(sample(-a), sample(0), sample(a)).mul(inside);
    // 画素グリッド（画素の間にすき間）と走査線
    const cell = fract(pc);
    const grid = smoothstep(0.06, 0.16, cell.x).mul(float(1).sub(smoothstep(0.84, 0.94, cell.x)))
      .mul(smoothstep(0.06, 0.16, cell.y)).mul(float(1).sub(smoothstep(0.84, 0.94, cell.y)));
    const scan = float(1).sub(float(L.scanlineAmount).mul(abs(fract(pc.y.mul(0.5).sub(time.mul(L.scanlineSpeed))).sub(0.5)).mul(2)));
    // 液晶の地の光は縁ほど暗く（球の輪郭を見せる）
    const back = smoothstep(0, 0.8, n.z).mul(L.backlightHdr);
    const lit = mix(vec3(back), vec3(L.faceHdr), faceRgb.mul(grid));
    mat.emissiveNode = lit.mul(this.faceColor).mul(scan).mul(this.dim);
    this.material = mat;

    this.light = new THREE.PointLight(0xffffff, L.light.intensity, L.light.rangeM);
  }

  /**
   * 毎フレーム呼ぶ。
   * @param heldByMeFps 自分が FPS で持っている（顔を暗くして視界を遮らない）
   */
  update(stage: FaceStage, timeSec: number, heldByMeFps: boolean): void {
    const L = this.look;
    this.frame.value = STAGE_FRAME[stage];
    this.faceColor.value.copy(this.colors[stage]);
    const blinkOff = (stage === 'blink' || stage === 'crack') && fract01(timeSec / L.blinkPeriodSec) >= 0.5;
    const d = (heldByMeFps ? L.heldDim : 1) * (blinkOff ? 0.35 : 1);
    this.dim.value = d;
    this.light.color.copy(this.colors[stage]);
    this.light.intensity = L.light.intensity * d;
  }
}

function fract01(v: number): number {
  return v - Math.floor(v);
}
