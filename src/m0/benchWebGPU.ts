// M0: WebGPURenderer（WebGPU バックエンド / ?forceWebGL=1 で WebGL2 バックエンド）のベンチ
import * as THREE from 'three/webgpu';
import type * as ThreeNS from 'three';
import { pass, mrt, output, emissive } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { buildBenchScene, BENCH_WIDTH, BENCH_HEIGHT } from './benchScene';
import { runBench, publish } from './benchRunner';

async function main(): Promise<void> {
  const forceWebGL = new URLSearchParams(location.search).get('forceWebGL') === '1';
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(BENCH_WIDTH, BENCH_HEIGHT, false);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  document.body.appendChild(renderer.domElement);

  const bench = buildBenchScene(THREE as unknown as typeof ThreeNS);

  // emissive を MRT で分離し、光る物だけにブルーム（GDD 12.2）→ SMAA
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(bench.scene as unknown as THREE.Scene, bench.camera as unknown as THREE.Camera);
  scenePass.setMRT(mrt({ output, emissive }));
  const color = scenePass.getTextureNode('output');
  const glow = bloom(scenePass.getTextureNode('emissive'), 1.0, 0.4, 0.0);
  pipeline.outputNode = smaa(color.add(glow));

  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    device?: GPUDevice;
    gl?: WebGL2RenderingContext;
  };
  const isWebGPU = backend.isWebGPUBackend === true;
  const pixel = new Uint8Array(4);

  const result = await runBench(
    {
      renderer: 'WebGPURenderer',
      backend: isWebGPU ? 'webgpu' : 'webgl2',
      renderFrame(t) {
        bench.update(t);
        pipeline.render();
      },
      async waitGpu() {
        if (isWebGPU && backend.device) await backend.device.queue.onSubmittedWorkDone();
        else backend.gl?.readPixels(0, 0, 1, 1, backend.gl.RGBA, backend.gl.UNSIGNED_BYTE, pixel);
      },
      stats: () => ({ drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }),
    },
    BENCH_WIDTH,
    BENCH_HEIGHT,
  );
  if (forceWebGL) result.note = 'forceWebGL=1';
  publish(result);
}

main().catch((e: unknown) => publish({ error: String(e) }));
