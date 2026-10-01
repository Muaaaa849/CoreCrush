// data/ の JSON をスキーマと追加ルールで検証する（npm run validate:data）
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`NG  ${msg}`);
};

const balance = load('data/balance.json');
const validate = ajv.compile(load('schemas/balance.schema.json'));
if (!validate(balance)) {
  for (const e of validate.errors ?? []) fail(`balance.json${e.instancePath} ${e.message}`);
} else {
  // スキーマで書けない関係（invariants.md INV-06 ほか）
  const c = balance.catch;
  const p = balance.parry;
  c.windowByDefenseF.forEach((w, i) => {
    const just = c.justByDefenseF[i];
    if (just > w) fail(`catch.justByDefenseF[${i}]=${just} が受付 ${w}F を超えている`);
    if (i > 0 && w < c.windowByDefenseF[i - 1]) fail(`catch.windowByDefenseF が防御の増加で減っている（${i}→${i + 1}）`);
  });
  // INV-06: 防御の中央値ではキャッチ受付 < 跳ね返し受付。高防御は並ぶ・超えるのを許容（防御キャラの特権）
  const med = c.windowByDefenseF[balance.stats.median - 1];
  if (med >= p.windowF) fail(`防御${balance.stats.median}（中央値）: キャッチ受付(${med}F) が跳ね返し受付(${p.windowF}F) 以上（INV-06）`);
  if (c.gain <= p.gain) fail('キャッチの獲得コスト <= 跳ね返し（INV-06）');
  if (c.whiffStaggerF <= p.whiffStaggerF) fail('キャッチ空振り硬直 <= 跳ね返し空振り硬直（INV-06）');
  if (balance.player.pickupRadiusM <= balance.player.bodyRadiusM) fail('取得半径がキャラ半径以下（INV-22）');
  if (balance.count.faceSec.nervous >= balance.count.faceSec.angry || balance.count.faceSec.angry >= balance.count.faceSec.blink || balance.count.faceSec.blink >= balance.count.faceSec.crack || balance.count.faceSec.crack >= balance.count.explodeSec)
    fail('コアの顔の段階がカウント順になっていない（INV-08）');
  for (const [name, t] of Object.entries(balance.throw.types)) {
    if (name !== 'aimed' && !t.homing) fail(`throw.types.${name}: 狙い投げ以外は追尾必須（INV-02）`);
  }
}

// 画質段階（Q-31 回答）
const quality = load('data/quality.json');
const validateQ = ajv.compile(load('schemas/quality.schema.json'));
if (!validateQ(quality)) {
  for (const e of validateQ.errors ?? []) fail(`quality.json${e.instancePath} ${e.message}`);
} else {
  const s = quality.auto.scaleSteps;
  if (s[0] !== 1) fail('quality.auto.scaleSteps の先頭が 1 でない');
  s.forEach((v, i) => {
    if (i > 0 && v >= s[i - 1]) fail(`quality.auto.scaleSteps が降順でない（${i}）`);
  });
  // 段階が下がるほど重い要素が増えない
  const order = ['high', 'mid', 'low'];
  for (let i = 1; i < order.length; i++) {
    const a = quality.presets[order[i - 1]];
    const b = quality.presets[order[i]];
    for (const k of ['pixelRatioMax', 'bloomScale', 'shadowMapSize', 'particleMul', 'decorMul']) {
      if (b[k] > a[k]) fail(`quality.presets.${order[i]}.${k} が ${order[i - 1]} より大きい`);
    }
    for (const k of ['smaa', 'floorReflection', 'lensFlare', 'edgeBlur', 'filmFx', 'ao']) if (b[k] && !a[k]) fail(`quality.presets.${order[i]}.${k} が ${order[i - 1]} より重い`);
  }
}

// 画づくり（GDD 12.2）
const render = load('data/render.json');
const validateR = ajv.compile(load('schemas/render.schema.json'));
if (!validateR(render)) for (const e of validateR.errors ?? []) fail(`render.json${e.instancePath} ${e.message}`);
else {
  // 小物・遠景が参照するアセットが一覧にあること
  const models = new Set(load('art/models.json').models.map((m) => m.id));
  for (const g of render.stage.props) if (!models.has(g.model)) fail(`render.json stage.props: モデル ${g.model} が art/models.json にない`);
  if (!models.has(render.stage.fire.model)) fail(`render.json stage.fire.model ${render.stage.fire.model} が art/models.json にない`);
  const textures = new Set(load('art/assets.json').textures.map((t) => t.id));
  const bd = render.stage.backdrop;
  for (const id of [bd.sky.texture, ...bd.layers.map((l) => l.texture)]) if (!textures.has(id)) fail(`render.json 遠景のテクスチャ ${id} が art/assets.json にない`);
}

// コアの顔（GDD 13）
const face = load('data/vfx/coreFace.json');
const validateF = ajv.compile(load('schemas/coreFace.schema.json'));
if (!validateF(face)) for (const e of validateF.errors ?? []) fail(`vfx/coreFace.json${e.instancePath} ${e.message}`);
else {
  for (const [name, rows] of Object.entries(face.frames)) {
    if (rows.length !== face.gridPx) fail(`vfx/coreFace.json frames.${name}: 行数 ${rows.length} ≠ gridPx ${face.gridPx}`);
    rows.forEach((r, i) => r.length !== face.gridPx && fail(`vfx/coreFace.json frames.${name}[${i}]: 長さ ${r.length} ≠ ${face.gridPx}`));
  }
  if (face.faceHdr * face.heldDim >= render.bloom.threshold) fail('coreFace: 所持中（heldDim）でもブルームのしきい値を超える（視界を遮る）');
}

// プラズマ・フェンス（GDD 13）
const fence = load('data/vfx/plasmaFence.json');
const validateP = ajv.compile(load('schemas/plasmaFence.schema.json'));
if (!validateP(fence)) for (const e of validateP.errors ?? []) fail(`vfx/plasmaFence.json${e.instancePath} ${e.message}`);
else if (fence.heightM > balance.court.ceilingM) fail('plasmaFence.heightM が天井より高い');

// ボールの軌跡（GDD 13）
const trail = load('data/vfx/ballTrail.json');
const validateT = ajv.compile(load('schemas/ballTrail.schema.json'));
if (!validateT(trail)) for (const e of validateT.errors ?? []) fail(`vfx/ballTrail.json${e.instancePath} ${e.message}`);
else {
  // VFX はコアの可読性を下げない: 軌跡の芯はコアの顔より暗く
  if (trail.coreHdr >= face.faceHdr) fail(`ballTrail.coreHdr(${trail.coreHdr}) がコアの顔(${face.faceHdr}) 以上`);
  if (trail.edgeHdr > trail.coreHdr) fail('ballTrail.edgeHdr が coreHdr より明るい');
  for (const k of Object.keys(balance.throw.types)) if (!(k in trail.colors)) fail(`ballTrail.colors に球種 ${k} がない`);
}

// キャッチ・跳ね返し・フェンス通過の演出（GDD 13）
const impact = load('data/vfx/impact.json');
const validateI = ajv.compile(load('schemas/impact.schema.json'));
if (!validateI(impact)) for (const e of validateI.errors ?? []) fail(`vfx/impact.json${e.instancePath} ${e.message}`);
else {
  // VFX はコアの可読性を下げない: 輪・火花はコアの顔より暗く
  for (const [id, p] of Object.entries(impact.presets)) {
    for (const r of p.rings) if (r.hdr >= face.faceHdr) fail(`impact.presets.${id}.rings.hdr(${r.hdr}) がコアの顔(${face.faceHdr}) 以上`);
    if (p.sparks.hdr >= face.faceHdr) fail(`impact.presets.${id}.sparks.hdr(${p.sparks.hdr}) がコアの顔(${face.faceHdr}) 以上`);
    if (p.sparks.count > impact.sparkPool) fail(`impact.presets.${id}.sparks.count がプールより多い`);
  }
}

if (failed) process.exit(1);
console.log('OK  data/balance.json, data/quality.json, data/render.json, data/vfx/coreFace.json, data/vfx/plasmaFence.json, data/vfx/ballTrail.json, data/vfx/impact.json');
