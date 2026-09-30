// 計測ラボを1ファイルの IIFE にまとめる（Artifact に埋め込むため）
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, '../../../dist-lab'),
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: resolve(import.meta.dirname, 'lab.ts'),
      formats: ['iife'],
      name: 'CoreCrushLab',
      fileName: () => 'lab.js',
    },
  },
});
