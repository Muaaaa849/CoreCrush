// ポストプロセス（GDD 12.2）: 光る物（ネオン・コア・フェンス）だけにブルーム → レンズの不完全さ → トーンマップ → SMAA → グレーディング。
// ブルームはトーンマップ前の HDR 色に高いしきい値で掛ける（emissive を強くした物だけが超える）。
// MRT で emissive を分ける方式は、半透明の物（フェンス・TPS の自分）が後ろのコアの発光を上書きするので採らない（ADR 0005）。
// シネマティックなコンポジット（docs/research/graphics-compositing.md）:
//   HDR 段: ブルーム（ハレーションで暖色に寄せる）＋レンズフレア、画面端だけのぼけと色収差（中心＝照準とコアは触らない）
//   表示段: トーンマップ（ACES）→ SMAA → カーブ（CDL）・スプリットトーン・ビネット・ライトリーク・グレイン
// 数値は data/render.json の post。画質段階（quality.ts）の lensFlare・edgeBlur・filmFx で重い物を外す。
import * as THREE from 'three/webgpu';
import {
  Fn, color, convertToTexture, dot, exp, float, length, max, mix, pass, rand, renderOutput, screenSize, sin, smoothstep, time, uv, vec2, vec3, vec4,
  cdl,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import renderJson from '../../data/render.json';
import type { QualityPreset } from './quality';
import type { StageLook } from './stage';

type Vec3 = [number, number, number];
export interface PostLook {
  vignette: { amount: number; radius: number; softness: number };
  edgeBlur: { startR: number; maxPx: number };
  chromaticAberration: { startR: number; amountPx: number };
  grain: { amount: number; shadowPow: number };
  lensFlare: { threshold: number; ghostSamples: number; ghostSpacing: number; ghostAttenuation: number; blurSigma: number; strength: number; tint: string };
  lightLeak: { color: string; amount: number; sizeR: number; speed: number };
  grade: {
    slope: Vec3; offset: Vec3; power: Vec3; saturation: number; contrast: number;
    shadowTint: string; highlightTint: string; splitAmount: number;
    halation: { color: string; amount: number };
  };
  dust: DustLook;
  ao: { radius: number; thickness: number; samples: number; intensity: number; resolutionScale: number };
}

export interface DustLook { count: number; sizePx: number; hdr: number; color: string; areaM: Vec3; driftMps: number }

export interface RenderLook {
  toneMappingExposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  post: PostLook;
  stage: StageLook;
}

export const RENDER_LOOK: RenderLook = renderJson as unknown as RenderLook;

/** 調整用の表示（試作の ?post=glow）。glow = ブルームだけ */
export type PostDebugView = 'none' | 'glow';

/** BloomNode の内部解像度の標準（描画解像度に対する倍率）。画質の bloomScale はこれに掛ける */
const BLOOM_BASE_RESOLUTION = 0.5;
/** 画面端のぼけのサンプル数（円周上） */
const EDGE_TAPS = 8;

export class PostPipeline {
  private readonly pipeline: THREE.RenderPipeline;
  private key = '';
  /** 組み直すときに render target を解放するノード */
  private owned: { dispose(): void }[] = [];

  constructor(
    renderer: THREE.WebGPURenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly debugView: PostDebugView = 'none',
    private readonly look: RenderLook = RENDER_LOOK,
  ) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    // トーンマップと色空間の変換は自分で（グレーディングをその後の表示色で掛けるため）
    this.pipeline.outputColorTransform = false;
  }

  /** 画質段階に合わせてノードを組み直す（同じ構成なら何もしない。試合中には呼ばない前提） */
  configure(preset: QualityPreset): void {
    const key = `${preset.bloomScale}|${preset.smaa}|${preset.lensFlare}|${preset.edgeBlur}|${preset.filmFx}|${preset.ao}`;
    if (key === this.key) return;
    this.key = key;
    this.disposeNodes();
    const P = this.look.post;
    const scenePass = pass(this.scene, this.camera);
    this.owned.push(scenePass);
    let color4: THREE.Node<'vec4'> = scenePass.getTextureNode('output');
    if (preset.ao) {
      // 環境遮蔽（GTAO、半解像度）: 接地感と隙間の陰。法線は深度から復元（MRT を使わない＝半透明の物の問題を避ける、ADR 0005）
      const A = P.ao;
      const occ = ao(scenePass.getTextureNode('depth'), null as unknown as THREE.Node, this.camera);
      occ.resolutionScale = A.resolutionScale;
      occ.radius.value = A.radius;
      occ.thickness.value = A.thickness;
      occ.samples.value = A.samples;
      this.owned.push(occ);
      color4 = vec4(color4.rgb.mul(mix(float(1), occ.getTextureNode().r, A.intensity)), 1);
    }
    if (preset.bloomScale > 0) {
      const b = this.look.bloom;
      const glow = bloom(color4, b.strength, b.radius, b.threshold);
      glow.setResolutionScale(BLOOM_BASE_RESOLUTION * preset.bloomScale);
      this.owned.push(glow);
      if (this.debugView === 'glow') {
        this.pipeline.outputNode = renderOutput(glow);
        this.pipeline.needsUpdate = true;
        return;
      }
      // ハレーション: 光のにじみを暖色に寄せる（フィルムの赤橙のにじみ）
      const H = P.grade.halation;
      const halo = mix(vec3(1), color(H.color), H.amount);
      color4 = vec4(color4.rgb.add(glow.rgb.mul(halo)), 1);
      if (preset.lensFlare) {
        const F = P.lensFlare;
        const flare = lensflare(glow, { ghostTint: color(F.tint), threshold: float(F.threshold), ghostSamples: float(F.ghostSamples), ghostSpacing: float(F.ghostSpacing), ghostAttenuationFactor: float(F.ghostAttenuation) });
        const soft = gaussianBlur(flare, float(1), F.blurSigma);
        this.owned.push(flare, soft);
        color4 = vec4(color4.rgb.add(soft.rgb.mul(F.strength)), 1);
      }
    }
    if (preset.edgeBlur) {
      const src = convertToTexture(color4);
      this.owned.push(src as unknown as { dispose(): void });
      color4 = lensEdges(src, P);
    }
    // 表示色へ（ACES・sRGB）
    let out: THREE.Node<'vec4'> = renderOutput(color4);
    if (preset.smaa) {
      const aa = smaa(out);
      this.owned.push(aa);
      out = aa as unknown as THREE.Node<'vec4'>;
    }
    this.pipeline.outputNode = grade(out, P, preset.filmFx);
    this.pipeline.needsUpdate = true;
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.disposeNodes();
    this.pipeline.dispose();
  }

  private disposeNodes(): void {
    for (const n of this.owned) n.dispose();
    this.owned.length = 0;
  }
}

/** 画面の中心からの距離（縦の半分を 1。横長でも円になる） */
const radial = Fn(() => {
  const d = uv().sub(0.5).mul(vec2(screenSize.x.div(screenSize.y), 1)).mul(2);
  return length(d);
});

/** 画面端だけのぼけと色収差（中心は元の画素のまま）。HDR のまま掛ける */
function lensEdges(src: ReturnType<typeof convertToTexture>, P: PostLook): THREE.Node<'vec4'> {
  return Fn(() => {
    const st = uv();
    const r = radial();
    const px = vec2(1).div(screenSize);
    const E = P.edgeBlur;
    const C = P.chromaticAberration;
    const blurPx = smoothstep(E.startR, 1.6, r).mul(E.maxPx);
    const base = src.sample(st).rgb.toVar();
    // 円周上のサンプル（ブラーの量だけ広げる）
    const acc = base.toVar();
    for (let i = 0; i < EDGE_TAPS; i++) {
      const a = (i / EDGE_TAPS) * Math.PI * 2;
      acc.addAssign(src.sample(st.add(vec2(Math.cos(a), Math.sin(a)).mul(px).mul(blurPx))).rgb);
    }
    const blurred = acc.div(EDGE_TAPS + 1);
    // 色収差: 外向きに R、内向きに B をずらす（半径に比例、中心は 0）
    const dir = st.sub(0.5);
    const ca = smoothstep(C.startR, 1.6, r).mul(C.amountPx);
    const off = dir.mul(px).mul(ca).mul(2);
    const red = src.sample(st.add(off)).r;
    const blue = src.sample(st.sub(off)).b;
    const caW = smoothstep(C.startR, 1.6, r);
    const rgb = vec3(mix(blurred.r, red, caW.mul(0.5)), blurred.g, mix(blurred.b, blue, caW.mul(0.5)));
    return vec4(rgb, 1);
  })();
}

/** 表示色のグレーディング（カーブ・スプリットトーン・ビネット）とフィルムの質感（ライトリーク・グレイン） */
function grade(input: THREE.Node<'vec4'>, P: PostLook, filmFx: boolean): THREE.Node<'vec4'> {
  return Fn(() => {
    const G = P.grade;
    const c0 = input.rgb;
    let c = cdl(vec4(c0, 1), vec3(...G.slope), vec3(...G.offset), vec3(...G.power), float(G.saturation)).rgb;
    // S 字のコントラスト
    c = mix(c, c.mul(c).mul(vec3(3).sub(c.mul(2))), G.contrast);
    // スプリットトーン: 影を寒色、明部を暖色へ
    const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const tint = mix(color(G.shadowTint), color(G.highlightTint), smoothstep(0.1, 0.7, luma));
    // 色味だけを掛ける（明るさで割って灰色＝1 にする）
    const hue = tint.div(max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3));
    c = mix(c, c.mul(hue), G.splitAmount);
    const r = radial();
    // ビネット
    const V = P.vignette;
    const vig = smoothstep(V.radius + V.softness, V.radius, r);
    c = c.mul(mix(float(1 - V.amount), float(1), vig));
    if (filmFx) {
      // ライトリーク: 左上の画面外から差し込む暖色の柔らかい光（ゆっくり動く）
      const L = P.lightLeak;
      const st = uv();
      const center = vec2(sin(time.mul(L.speed)).mul(0.08).sub(0.05), float(-0.05));
      const d = length(st.sub(center).mul(vec2(screenSize.x.div(screenSize.y), 1)));
      const leak = exp(d.mul(d).div(L.sizeR * L.sizeR).negate()).mul(L.amount);
      c = c.add(color(L.color).mul(leak).mul(float(1).sub(c)));
      // グレイン: 暗部ほど強い（露光に反比例）
      const Gr = P.grain;
      const n = rand(st.mul(screenSize).add(vec2(time.mul(61.7), time.mul(37.3)))).sub(0.5);
      const w = float(1).sub(luma).pow(Gr.shadowPow).mul(Gr.amount);
      c = c.add(n.mul(w));
    }
    return vec4(max(c, vec3(0)), 1);
  })();
}
