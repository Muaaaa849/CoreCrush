// 1本の接続での開始の合意と再戦（前の試合の遅れて届いた分が次の試合を壊さない）
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOT, botInput, createBot, type Bot } from '../../src/bot/simpleBot';
import { loadBalance } from '../../src/data/loadBalance';
import { LoopbackLink } from '../../src/net/loopback';
import { OnlineSession } from '../../src/net/session';
import { NO_INPUT } from '../../src/sim/types';
import { MEDIAN, TICK_MS, logKey } from './harness';

function tickBoth(link: LoopbackLink, s: [OnlineSession, OnlineSession], bots: [Bot, Bot] | null): boolean[] {
  const started = s.map((x) => x.pump());
  for (const k of [0, 1] as const) {
    const p = s[k].peer;
    if (p) p.step(bots ? botInput(p.w, bots[k]) : { ...NO_INPUT });
  }
  link.advance(TICK_MS);
  return started;
}

describe('オンラインのセッション', () => {
  it('開始の合意 → 1試合 → 再戦 → 2試合目も両者で一致する（RTT 160ms・ロス 5%）', () => {
    const b = loadBalance();
    const link = new LoopbackLink({ rttMs: 160, loss: 0.05, jitterMs: 5, seed: 4 });
    let seed = 100;
    const s: [OnlineSession, OnlineSession] = [
      new OnlineSession(link.a, { balance: b, role: 0, stats: [MEDIAN, MEDIAN], randomSeed: () => seed++ }),
      new OnlineSession(link.b, { balance: b, role: 1, stats: [MEDIAN, MEDIAN] }),
    ];
    for (let match = 0; match < 2; match++) {
      // 役割 1 が hello を受け取って試合が始まるまで
      for (let t = 0; t < 60 && s[1].match !== match; t++) tickBoth(link, s, null);
      expect(s.map((x) => x.match)).toEqual([match, match]);
      const bots: [Bot, Bot] = [createBot(0, 1 + match, DEFAULT_BOT), createBot(1, 2 + match, DEFAULT_BOT)];
      let t = 0;
      while (t++ < 60 * 60 * 10 && (s[0].peer!.w.phase !== 'matchOver' || s[1].peer!.w.phase !== 'matchOver')) tickBoth(link, s, bots);
      for (let i = 0; i < 120; i++) tickBoth(link, s, bots);
      const [p0, p1] = [s[0].peer!, s[1].peer!];
      expect(p0.w.phase).toBe('matchOver');
      expect(p1.w.phase).toBe('matchOver');
      expect(logKey(p0)).toBe(logKey(p1));
      expect([p0.w.players[0].wins, p0.w.players[1].wins]).toEqual([p1.w.players[0].wins, p1.w.players[1].wins]);
      // 再戦: 片方だけでは始まらない
      s[1].requestRematch();
      for (let i = 0; i < 30; i++) tickBoth(link, s, null);
      expect(s[0].match).toBe(match);
      s[0].requestRematch();
    }
    // 2試合目のシードは1試合目と違う
    expect(seed).toBe(102);
  });
});
