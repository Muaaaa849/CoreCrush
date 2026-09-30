// GDD 11.3 必須テスト: 遅延注入で「フリ→ストレート」の成立率が遅延0時の ±5% 以内（INV-01 の通信版）
// 各 peer は自分の画面に見えている情報だけで動く:
//   A（投げ手）: フリ → 相手の空振り硬直が「見えたら」反応 R フレーム後に本投げ
//   B（受け手）: 相手の溜めが見えたら、リリースの瞬間（に見える時）にキャッチ → 空振り。その後 pressAt にキャッチ／跳ね返し
import { describe, expect, it } from 'vitest';
import { NO_INPUT, type PlayerInput } from '../../src/sim/types';
import { set } from '../../src/sim/math';
import { handOf } from '../../src/sim/ball';
import type { NetPeer } from '../../src/net/peer';
import { makePair, stepPair } from './harness';

const RTTS = [0, 80, 160];
const LOSSES = [0, 0.02, 0.05];
const DISTANCES = [5, 7, 9, 11, 13];

function setup(peer: NetPeer, d: number): void {
  const w = peer.w;
  set(w.players[0].pos, 0, 0, -d / 2);
  set(w.players[1].pos, 0, 0, d / 2);
  const ball = w.ball;
  ball.mode = 'held';
  ball.holder = 0;
  ball.side = 0;
  ball.countTicks = 0;
  ball.freezeTicks = 1e9; // カウントは関係させない
  w.players[0].holding = true;
  w.players[0].meter = 1;
  w.ballAuth = 0;
  handOf(w.balance, w.players[0], ball.pos);
}

type Defense = 'catch' | 'parry';

/** 被弾したら true */
function scenario(rtt: number, loss: number, seed: number, d: number, defense: Defense, pressAt: number): boolean {
  const p = makePair({ rttMs: rtt, loss, jitterMs: rtt > 0 ? 5 : 0, seed });
  for (const peer of p.peers) setup(peer, d);
  const [A, B] = p.peers;
  const b = A.w.balance;
  const reaction = b.invariants.fakeReactionBudgetF;
  let sawStaggerAt = -1;
  let whiffed = false;
  let sawWindup = false;
  let thrown = false;
  for (let t = 0; t < 400; t++) {
    const a: PlayerInput = { ...NO_INPUT };
    const r: PlayerInput = { ...NO_INPUT };
    if (t === 0) a.fake = true;
    // A: 相手の空振り硬直が見えたら反応して本投げ
    const bInA = A.w.players[1];
    if (sawStaggerAt < 0 && bInA.action === 'stagger') sawStaggerAt = t;
    if (!thrown && sawStaggerAt >= 0 && t === sawStaggerAt + reaction) {
      a.primary = true;
      thrown = true;
    }
    // B: 相手の溜めがリリースに届いたように見えた瞬間にキャッチ（フリなので空振り）
    // （揺れで溜めの最後の tick が見えないこともあるので、溜めの終わりが見えた時も押す）
    const aInB = B.w.players[0];
    if (aInB.action === 'windup') sawWindup = true;
    const releaseSeen = aInB.action === 'windup' ? aInB.actionTick >= b.throw.windupF - 1 : sawWindup;
    if (!whiffed && releaseSeen && B.w.players[1].action === 'idle') {
      r.secondary = true;
      whiffed = true;
    }
    if (thrown && t === pressAt) {
      if (defense === 'catch') r.secondary = true;
      else r.primary = true;
    }
    stepPair(p, a, r);
    for (const e of p.events[1].splice(0)) {
      if (e.side !== 1) continue;
      if (e.kind === 'hit') return true;
      if (e.kind === 'catch' || e.kind === 'justCatch' || e.kind === 'parry' || e.kind === 'miss') return false;
    }
    p.events[0].length = 0;
  }
  throw new Error(`決着しなかった rtt ${rtt} d ${d} ${defense} ${pressAt}`);
}

function rate(rtt: number, loss: number): number {
  let hits = 0;
  let total = 0;
  for (const d of DISTANCES) {
    for (const defense of ['catch', 'parry'] as const) {
      for (let pressAt = 0; pressAt < 160; pressAt += 2) {
        total++;
        if (scenario(rtt, loss, 1 + pressAt, d, defense, pressAt)) hits++;
      }
    }
  }
  return hits / total;
}

describe('遅延注入: フリ→ストレートの成立率', () => {
  const base = rate(0, 0);
  it('遅延0で成立（全距離・全タイミングで被弾）', () => {
    expect(base).toBe(1);
  });
  for (const rtt of RTTS) {
    for (const loss of LOSSES) {
      if (rtt === 0 && loss === 0) continue;
      it(`RTT ${rtt}ms × ロス ${loss * 100}%: 成立率が遅延0時の ±5% 以内`, () => {
        const r = rate(rtt, loss);
        process.stdout.write(`fake-straight rtt ${rtt} loss ${loss}: ${(r * 100).toFixed(1)}%\n`);
        expect(Math.abs(r - base)).toBeLessThanOrEqual(0.05);
      });
    }
  }
});
