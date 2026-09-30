import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, STATE_REDUNDANCY, decode, encodeEvent, encodeState } from '../../src/net/protocol';
import { captureBall, captureState, createBallWire, type AuthEvent, type RemoteState } from '../../src/sim/judge/remote';
import { DEFAULT_BOT, botInput, createBot } from '../../src/bot/simpleBot';
import { logKey, makePair, stepPair } from './harness';
import { giveBall, makeWorld, run } from '../sim/helpers';

describe('プロトコル', () => {
  it('イベントは値を失わずに往復する（float64）', () => {
    const w = makeWorld();
    giveBall(w, 0);
    run(w, 12, (t) => [t === 0 ? { primary: true, moveRight: 1 } : {}]);
    const ev: AuthEvent = { seq: 7, tick: w.tick, round: 1, kind: 'release', side: 0, value: Math.PI, hp: NaN, ballAuth: 1, ball: captureBall(w, createBallWire()) };
    const m = decode(encodeEvent(ev));
    expect(m.type).toBe('event');
    if (m.type !== 'event') return;
    expect(m.event.hp).toBeNaN();
    expect({ ...m.event, hp: 0 }).toEqual({ ...ev, hp: 0 });
  });
  it('状態は直近を冗長同梱し、新しい順に読める', () => {
    const w = makeWorld({ });
    const states: RemoteState[] = [];
    for (let i = 0; i < 6; i++) {
      run(w, 1);
      states.unshift(captureState({ ...w, local: 0 }, {} as RemoteState));
    }
    const m = decode(encodeState(states));
    expect(m.type).toBe('state');
    if (m.type !== 'state') return;
    expect(m.states.length).toBe(STATE_REDUNDANCY);
    expect(m.states.map((s) => s.tick)).toEqual(states.slice(0, STATE_REDUNDANCY).map((s) => s.tick));
  });
  it('版数が違うメッセージは拒否する', () => {
    const buf = encodeState([]);
    new DataView(buf).setUint8(0, PROTOCOL_VERSION + 1);
    expect(() => decode(buf)).toThrow();
  });
});

describe('決定論', () => {
  it('同じシード・同じ遅延条件の再生で、確定イベントログが完全に一致する', () => {
    const play = () => {
      const p = makePair({ rttMs: 80, loss: 0.05, jitterMs: 5, seed: 9 }, { seed: 9 });
      const bots = [createBot(0, 11, DEFAULT_BOT), createBot(1, 12, DEFAULT_BOT)] as const;
      for (let t = 0; t < 60 * 60 && p.peers[0].w.phase !== 'matchOver'; t++) stepPair(p, botInput(p.peers[0].w, bots[0]), botInput(p.peers[1].w, bots[1]));
      return logKey(p.peers[0]) + '\n---\n' + logKey(p.peers[1]);
    };
    const a = play();
    expect(a.length).toBeGreaterThan(100);
    expect(play()).toBe(a);
  });
});
