import { describe, expect, it } from 'vitest';
import { RemoteTrack } from '../../src/net/remoteTrack';
import { createRng, nextFloat } from '../../src/sim/rng';

describe('相手の補間表示（RemoteTrack）', () => {
  it('揺れて届いても、表示は一定速度で滑らかに動き、遅延＋補間遅延ぶん遅れる', () => {
    const track = new RemoteTrack();
    const rng = createRng(3);
    const speed = 0.1; // 相手は 1 tick に 0.1m 進む
    const latency = 5; // 片道 5 tick
    const delay = 6;
    const arrivals: { at: number; tick: number }[] = [];
    for (let t = 0; t < 300; t++) {
      // 揺れ ±2 tick、10% ロス
      if (nextFloat(rng) < 0.1) continue;
      arrivals.push({ at: t + latency + Math.round((nextFloat(rng) * 2 - 1) * 2), tick: t });
    }
    const out = { x: 0, z: 0 };
    const xs: number[] = [];
    for (let local = 0; local < 300; local++) {
      for (const a of arrivals) if (a.at === local) track.push(a.tick, a.tick * speed, 0, local);
      if (local >= 60 && track.sample(local, delay, out)) xs.push(out.x);
    }
    // 速度（隣り合う差）がほぼ一定＝カクつかない
    const d = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const v of d) expect(Math.abs(v - speed)).toBeLessThan(0.051);
    // 遅れ ≒ 最短の到着遅延 + 補間遅延（揺れの最小値 latency-2 を仮定）
    const lastLocal = 299;
    const lagTicks = (lastLocal * speed - xs[xs.length - 1]!) / speed;
    expect(lagTicks).toBeGreaterThanOrEqual(latency - 2 + delay - 0.5);
    expect(lagTicks).toBeLessThanOrEqual(latency + 2 + delay + 0.5);
  });
  it('逆順・重複は捨て、reset で履歴を消す', () => {
    const track = new RemoteTrack();
    const out = { x: 0, z: 0 };
    track.push(10, 1, 0, 10);
    track.push(9, 99, 0, 10);
    track.push(10, 99, 0, 10);
    expect(track.sample(20, 0, out)).toBe(true);
    expect(out.x).toBe(1);
    track.reset();
    expect(track.sample(20, 0, out)).toBe(false);
  });
});
