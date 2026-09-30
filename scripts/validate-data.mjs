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
    if (w >= p.windowF) fail(`防御${i + 1}: キャッチ受付(${w}F) が跳ね返し受付(${p.windowF}F) 以上（INV-06）`);
    // OPEN: Q-28 iron_grip(+1F) 込みで並ぶ場合は警告に留める
    else if (w + 1 >= p.windowF) console.warn(`WARN 防御${i + 1}+iron_grip: キャッチ受付 ${w + 1}F が跳ね返し受付 ${p.windowF}F と並ぶ（Q-28）`);
    if (i > 0 && w < c.windowByDefenseF[i - 1]) fail(`catch.windowByDefenseF が防御の増加で減っている（${i}→${i + 1}）`);
  });
  if (c.gain <= p.gain) fail('キャッチの獲得コスト <= 跳ね返し（INV-06）');
  if (c.whiffStaggerF <= p.whiffStaggerF) fail('キャッチ空振り硬直 <= 跳ね返し空振り硬直（INV-06）');
  if (balance.player.pickupRadiusM <= balance.player.bodyRadiusM) fail('取得半径がキャラ半径以下（INV-22）');
  if (balance.count.faceSec.nervous >= balance.count.faceSec.angry || balance.count.faceSec.angry >= balance.count.faceSec.blink || balance.count.faceSec.blink >= balance.count.faceSec.crack || balance.count.faceSec.crack >= balance.count.explodeSec)
    fail('コアの顔の段階がカウント順になっていない（INV-08）');
  for (const [name, t] of Object.entries(balance.throw.types)) {
    if (name !== 'aimed' && !t.homing) fail(`throw.types.${name}: 狙い投げ以外は追尾必須（INV-02）`);
  }
}
if (failed) process.exit(1);
console.log('OK  data/balance.json');
