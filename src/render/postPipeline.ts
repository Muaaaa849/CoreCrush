// ポストプロセス（GDD 12.2）: 光る物（ネオン・コア・フェンス）だけにブルーム → SMAA。
// ブルームはトーンマップ前の HDR 色に高いしきい値で掛ける（emissive を強くした物だけが超える）。
// MRT で emissive を分ける方式は、半透明の物（フェンス・TPS の自分）が後ろのコアの発光を上書きするので採らない（ADR 0005）。
// 画質段階（quality.ts）の bloomScale・smaa で組み替える。トーンマップと色空間の変換は RenderPipeline の出力で行う。
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import renderJson from '../../data/render.json';
import type { QualityPreset } from './quality';

export interface RenderLook {
  toneMappingExposure: number;
  bloom: { strength: number; radius: number; threshold: number };
}

export const RENDER_LOOK: RenderLook = renderJson as RenderLook;

/** 調整用の表示（試作の ?post=glow）。glow = ブルームだけ */
export type PostDebugView = 'none' | 'glow';

/** BloomNode の内部解像度の標準（描画解像度に対する倍率）。画質の bloomScale はこれに掛ける */
const BLOOM_BASE_RESOLUTION = 0.5;

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
  }

  /** 画質段階に合わせてノードを組み直す（同じ構成なら何もしない。試合中には呼ばない前提） */
  configure(preset: QualityPreset): void {
    const key = `${preset.bloomScale}|${preset.smaa}`;
    if (key === this.key) return;
    this.key = key;
    this.disposeNodes();
    const scenePass = pass(this.scene, this.camera);
    this.owned.push(scenePass);
    let color: THREE.Node<'vec4'> = scenePass.getTextureNode('output');
    if (preset.bloomScale > 0) {
      const b = this.look.bloom;
      const glow = bloom(color, b.strength, b.radius, b.threshold);
      glow.setResolutionScale(BLOOM_BASE_RESOLUTION * preset.bloomScale);
      this.owned.push(glow);
      color = this.debugView === 'glow' ? glow : color.add(glow);
    }
    if (preset.smaa) {
      const aa = smaa(color);
      this.owned.push(aa);
      this.pipeline.outputNode = aa;
    } else this.pipeline.outputNode = color;
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
