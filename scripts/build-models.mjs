// 3D モデルの変換（npm run assets の後半）: art/models.json の Poly Haven（CC0）モデルを取得し、
// 重複除去・頂点の結合・（指定があれば）間引き・テクスチャ KTX2（法線 UASTC／色 ETC1S sRGB／その他 ETC1S 線形）・meshopt 圧縮の glb にする。
// 出力: assets/models/<id>.glb。元の glTF は art/source/polyhaven/models/<id>/ に置く（再現用）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, meshopt, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'art/models.json'), 'utf8'));
const outDir = resolve(root, 'assets/models');
mkdirSync(outDir, { recursive: true });
const only = process.argv[2];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO(fetch).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const imageDecoder = async (buf) => {
  const r = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(r.data), width: r.info.width, height: r.info.height };
};

async function download(url, path) {
  if (existsSync(path)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

for (const m of manifest.models) {
  if (only && m.id !== only) continue;
  const srcDir = resolve(root, 'art/source/polyhaven/models', m.id);
  const files = await (await fetch(`https://api.polyhaven.com/files/${m.id}`)).json();
  const g = files.gltf['1k'].gltf;
  const gltfPath = resolve(srcDir, `${m.id}.gltf`);
  await download(g.url, gltfPath);
  for (const [rel, inc] of Object.entries(g.include ?? {})) await download(inc.url, resolve(srcDir, rel));

  const doc = await io.read(gltfPath);
  await doc.transform(dedup(), prune(), weld(), resample());
  if (m.simplify < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: m.simplify, error: 0.002 }));
  // 外周の小物は遠目なので 512px で十分（容量: GDD 10 のステージ 10〜20MB）
  const size = m.textureSize ?? manifest.textureSize;
  await doc.transform(textureCompress({ encoder: sharp, resize: [size, size], targetFormat: 'png' }));
  await doc.transform(
    ktx2({ slots: /normalTexture/, isUASTC: true, isNormalMap: true, isSetKTX2SRGBTransferFunc: false, needSupercompression: true, generateMipmap: true, enableDebug: false, imageDecoder }),
    ktx2({ slots: /baseColorTexture|emissiveTexture/, isUASTC: false, isSetKTX2SRGBTransferFunc: true, qualityLevel: 200, generateMipmap: true, enableDebug: false, imageDecoder }),
    ktx2({ isUASTC: false, isSetKTX2SRGBTransferFunc: false, qualityLevel: 200, generateMipmap: true, enableDebug: false, imageDecoder }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  const glb = await io.writeBinary(doc);
  writeFileSync(resolve(outDir, `${m.id}.glb`), glb);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  console.log(`${m.id}.glb  ${(glb.length / 1024).toFixed(0)} KiB  ${Math.round(tris)} tris  ${doc.getRoot().listMeshes().reduce((n, x) => n + x.listPrimitives().length, 0)} prims`);
}
