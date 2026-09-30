// アセットの変換（npm run assets）: art/assets.json の一覧を、元画像の取得 → 緑背景の切り抜き → 縮小 → KTX2 にして assets/textures/ へ。
// 色は ETC1S（sRGB）、法線は UASTC、粗さなどの線形データは ETC1S（線形）。元画像は art/ に置いて再現できるようにする。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(resolve(root, 'art/assets.json'), 'utf8')));
const outDir = resolve(root, 'assets/textures');
mkdirSync(outDir, { recursive: true });
const only = process.argv[2];

/** 緑のクロマキー: 緑が赤・青より強いほど透明。縁の緑かぶりを抑える */
function chromaKey(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const spill = g - Math.max(r, b);
    const a = 1 - Math.min(1, Math.max(0, (spill - 30) / 60));
    data[i + 3] = Math.round(a * 255);
    if (spill > 0) data[i + 1] = Math.max(r, b);
  }
}

for (const t of manifest.textures) {
  if (only && t.id !== only) continue;
  const src = resolve(root, t.src);
  if (!existsSync(src)) {
    if (!t.url) throw new Error(`${t.src} がなく、取得元 url もない`);
    const res = await fetch(t.url);
    if (!res.ok) throw new Error(`${t.url}: ${res.status}`);
    mkdirSync(dirname(src), { recursive: true });
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  }
  let img = sharp(src).ensureAlpha();
  const meta = await sharp(src).metadata();
  const maxW = t.maxWidth ?? 2048;
  const w = Math.min(maxW, meta.width);
  // 4 の倍数に揃える（ブロック圧縮）
  const W = Math.floor(w / 4) * 4;
  const H = Math.max(4, Math.round((meta.height * W) / meta.width / 4) * 4);
  img = img.resize(W, H, { fit: 'fill' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (t.chromaKey) chromaKey(data);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const opts = {
    generateMipmap: true,
    enableDebug: false,
    imageDecoder: async (buf) => {
      const r = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data: new Uint8Array(r.data), width: r.info.width, height: r.info.height };
    },
  };
  if (t.kind === 'normal') Object.assign(opts, { isUASTC: true, isNormalMap: true, isSetKTX2SRGBTransferFunc: false, needSupercompression: true });
  else if (t.kind === 'linear') Object.assign(opts, { isUASTC: false, isSetKTX2SRGBTransferFunc: false, qualityLevel: 200 });
  else Object.assign(opts, { isUASTC: false, isSetKTX2SRGBTransferFunc: true, qualityLevel: 200 });
  const ktx = await encodeToKTX2(new Uint8Array(png), opts);
  const out = resolve(outDir, `${t.id}.ktx2`);
  writeFileSync(out, ktx);
  console.log(`${t.id}.ktx2  ${W}x${H}  ${(ktx.length / 1024).toFixed(0)} KiB`);
}
