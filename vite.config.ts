import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        benchWebgpu: resolve(import.meta.dirname, 'm0/bench-webgpu.html'),
        benchWebgl: resolve(import.meta.dirname, 'm0/bench-webgl.html'),
        pointerlock: resolve(import.meta.dirname, 'm0/pointerlock.html'),
        datachannel: resolve(import.meta.dirname, 'm0/datachannel.html'),
      },
    },
  },
});
