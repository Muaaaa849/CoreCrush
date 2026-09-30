// テクスチャの読み込み（KTX2）。`npm run assets` で作った assets/textures/<id>.ktx2 をページの隣から読む。
// 読めない環境（単一ファイルの Artifact 版など）では null を返し、呼び出し側は手続き的な見た目のまま続ける。
import * as THREE from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

let loader: KTX2Loader | null = null;

/** 公開ページで外部ファイルを読めるか（単一ファイルの Artifact 版では読めない） */
export function canLoadFiles(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

export function getKtx2Loader(renderer: THREE.WebGPURenderer): KTX2Loader {
  if (!loader) {
    // 開発サーバーでは node_modules から、公開ページではページの隣の basis/ から（scripts/proto-pages.mjs が置く）
    const path = import.meta.env.DEV ? '/node_modules/three/examples/jsm/libs/basis/' : 'basis/';
    loader = new KTX2Loader().setTranscoderPath(path);
    loader.detectSupport(renderer);
  }
  return loader;
}

export async function loadTexture(renderer: THREE.WebGPURenderer, id: string, opts: { repeat?: boolean } = {}): Promise<THREE.Texture | null> {
  if (!canLoadFiles()) return null;
  try {
    const t = await getKtx2Loader(renderer).loadAsync(`assets/textures/${id}.ktx2`);
    if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  } catch (e) {
    console.warn(`テクスチャ ${id} を読めませんでした（手続き的な見た目のまま）`, e);
    return null;
  }
}
