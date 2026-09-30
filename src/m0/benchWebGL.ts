// M0: 従来の WebGLRenderer ＋ EffectComposer（比較用。GDD 12.1 の代替案）
// 注: GDD の代替案は pmndrs/postprocessing だが、M0 では依存を増やさず three 同梱の Pass で近似する。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildBenchScene, countSceneDrawCalls, BENCH_WIDTH, BENCH_HEIGHT } from './benchScene';
import { runBench, type BenchOptions, type BenchResult } from './benchRunner';

export async function runWebGLBench(
  host: HTMLElement,
  options?: BenchOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<BenchResult> {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const composer = new EffectComposer(renderer);
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(BENCH_WIDTH, BENCH_HEIGHT, false);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.info.autoReset = false;
    host.appendChild(renderer.domElement);

    const bench = buildBenchScene(THREE);
    composer.setSize(BENCH_WIDTH, BENCH_HEIGHT);
    composer.addPass(new RenderPass(bench.scene, bench.camera));
    // しきい値高めで emissive だけを光らせる近似
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(BENCH_WIDTH, BENCH_HEIGHT), 1.0, 0.4, 0.9));
    composer.addPass(new SMAAPass());
    composer.addPass(new OutputPass());

    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    const result = await runBench(
      {
        renderer: 'WebGLRenderer',
        backend: 'webgl2',
        renderFrame(t) {
          renderer.info.reset();
          bench.update(t);
          composer.render();
        },
        async waitGpu() {
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        },
        stats: () => ({ drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
        sceneDrawCalls: () => countSceneDrawCalls(THREE, bench.scene, bench.camera),
      },
      BENCH_WIDTH,
      BENCH_HEIGHT,
      options,
      onProgress,
    );
    result.note = 'EffectComposer + UnrealBloomPass + SMAAPass（pmndrs ではない）';
    return result;
  } finally {
    renderer.domElement.remove();
    composer.dispose();
    renderer.dispose();
  }
}
