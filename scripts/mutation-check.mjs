// 感度チェック: balance の値をわざと壊し、不変条件テストが赤になることを確かめる（テストが「効いている」ことの証明）
import { spawnSync } from 'node:child_process';

const MUTATIONS = [
  ['INV-01 空振り硬直を短く', { catch: { whiffStaggerF: 30 } }],
  ['INV-01 ストレートを遅く', { throw: { types: { straight: { speedMps: 24 } } } }],
  ['INV-02 ストレートの追尾を外す', { throw: { types: { straight: { homing: false } } } }],
  ['INV-03 左右カーブを左右ステップで切れるように', { throw: { types: { curveLeft: { evade: ['front', 'back', 'left', 'right'] } } } }],
  ['INV-03 上カーブを前後で切れるように', { throw: { types: { lob: { evade: ['front', 'back'] } } } }],
  ['INV-03 ストレートを前後ステップで切れるように', { throw: { types: { straight: { evade: ['front', 'back', 'left', 'right'] } } } }],
  ['INV-05 フリのコストを0に', { fake: { cost: 0 } }],
  ['INV-06 キャッチ受付を跳ね返しより長く', { catch: { windowByDefenseF: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] } }],
  ['INV-07 爆発を9秒に', { count: { explodeSec: 9 } }],
  ['INV-08 終盤の伸びを消す', { count: { speedCurveAdd: 0 } }],
  ['INV-10 開幕の猶予を消す', { count: { roundStartFreezeSec: 0 } }],
  ['INV-11 ラリー加速を消す', { parry: { rallySpeedMul: 1 } }],
  ['INV-11 ラリーの威力上昇を消す', { parry: { rallyDamageAdd: 0 } }],
  ['INV-22 上カーブの頂点マージンを消す', { court: { trajectoryMarginM: -2 } }],
  ['INV-22 床をよく跳ねるように', { ball: { floorRestitution: 0.8 } }],
  ['INV-22 取得半径を体より小さく', { player: { pickupRadiusM: 0.1 } }],
];

let ok = true;
for (const [name, patch] of MUTATIONS) {
  const r = spawnSync('npx', ['vitest', 'run', 'tests/sim'], {
    env: { ...process.env, BALANCE_MUTATION: JSON.stringify(patch) },
    encoding: 'utf8',
  });
  const red = r.status !== 0;
  const failed = (r.stdout.match(/Tests\s+(\d+) failed/) ?? [])[1] ?? '0';
  console.log(`${red ? 'RED  ' : 'GREEN'} ${name}（失敗 ${failed} 件）`);
  if (!red) ok = false;
}
if (!ok) {
  console.error('感度不足: 壊しても緑のままの変異がある');
  process.exit(1);
}
console.log('OK  全ての変異でテストが赤になった');
