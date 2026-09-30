// GDD 11.3 必須テスト: RTT 0/80/160ms × ロス 0/2/5% の遅延注入で、両クライアントの確定イベントログと勝敗が一致する
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOT, botInput, createBot } from '../../src/bot/simpleBot';
import { logKey, makePair, stepPair } from './harness';

const RTTS = [0, 80, 160];
const LOSSES = [0, 0.02, 0.05];

function playMatch(rttMs: number, loss: number, seed: number) {
  const p = makePair({ rttMs, loss, jitterMs: rttMs > 0 ? 5 : 0, seed }, { seed });
  const bots = [createBot(0, seed * 7 + 1, DEFAULT_BOT), createBot(1, seed * 7 + 2, DEFAULT_BOT)] as const;
  let t = 0;
  const limit = 60 * 60 * 10;
  while (t++ < limit && (p.peers[0].w.phase !== 'matchOver' || p.peers[1].w.phase !== 'matchOver')) {
    stepPair(p, botInput(p.peers[0].w, bots[0]), botInput(p.peers[1].w, bots[1]));
  }
  // 送信中のものを流し切る
  for (let i = 0; i < 120; i++) stepPair(p, botInput(p.peers[0].w, bots[0]), botInput(p.peers[1].w, bots[1]));
  return { p, ticks: t };
}

describe('遅延注入マトリクス（両クライアントの一致）', () => {
  for (const rtt of RTTS) {
    for (const loss of LOSSES) {
      it(`RTT ${rtt}ms × ロス ${loss * 100}%: 決着し、勝敗・ラウンド結果・確定イベントログが一致`, () => {
        for (const seed of [1, 2, 3]) {
          const { p, ticks } = playMatch(rtt, loss, seed);
          const [a, b] = p.peers;
          expect(a.w.phase, `seed ${seed}: 決着しない（${ticks} tick）`).toBe('matchOver');
          expect(b.w.phase).toBe('matchOver');
          const rounds = (k: 0 | 1) => p.events[k].filter((e) => e.kind === 'roundEnd').map((e) => e.side).join(',');
          expect(rounds(0), `seed ${seed}`).toBe(rounds(1));
          expect([a.w.players[0].wins, a.w.players[1].wins]).toEqual([b.w.players[0].wins, b.w.players[1].wins]);
          expect(logKey(a)).toBe(logKey(b));
          expect(p.doubleAuthTicks).toBe(0);
          // 往復時間の推定（tick 刻みと揺れのぶん多めに出る）
          for (const peer of p.peers) {
            expect(peer.rttMs).toBeGreaterThanOrEqual(rtt - 10);
            expect(peer.rttMs).toBeLessThanOrEqual(rtt + 50);
          }
        }
      });
    }
  }
});
