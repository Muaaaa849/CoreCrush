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
    if (b.smaa && !a.smaa) fail(`quality.presets.${order[i]}.smaa が ${order[i - 1]} より重い`);
  }
}

if (failed) process.exit(1);
console.log('OK  data/balance.json, data/quality.json');
