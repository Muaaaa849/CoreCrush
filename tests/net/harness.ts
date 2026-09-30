// 2台の NetPeer を遅延注入ループバックでつなぎ、同じ 60Hz で進めるテスト用ハーネス
import { loadBalance, type DeepPartial } from '../../src/data/loadBalance';
import { LoopbackLink, type LinkOptions } from '../../src/net/loopback';
import { NetPeer } from '../../src/net/peer';
import type { Balance, Stats } from '../../src/sim/balance';
import type { PlayerInput, SimEvent } from '../../src/sim/types';

export const MEDIAN: Stats = { attack: 5, defense: 5, agility: 5 };
export const TICK_MS = 1000 / 60;

export interface Pair {
  link: LoopbackLink;
  peers: [NetPeer, NetPeer];
  /** 各 peer がこれまでに出したイベント（tick つき） */
  events: [SimEvent[], SimEvent[]];
  /** 両方が同時に判定権を持っていた tick 数（0 であること） */
  doubleAuthTicks: number;
}

export function makePair(link: LinkOptions, opts: { seed?: number; balance?: DeepPartial<Balance> } = {}): Pair {
  const b = loadBalance(opts.balance);
  const l = new LoopbackLink(link);
  const seed = opts.seed ?? 1;
  const peers: [NetPeer, NetPeer] = [
    new NetPeer(b, { seed, stats: [MEDIAN, MEDIAN], local: 0 }, l.a),
    new NetPeer(b, { seed, stats: [MEDIAN, MEDIAN], local: 1 }, l.b),
  ];
  return { link: l, peers, events: [[], []], doubleAuthTicks: 0 };
}

export function stepPair(p: Pair, i0: PlayerInput, i1: PlayerInput): void {
  p.peers[0].step(i0);
  p.peers[1].step(i1);
  for (const k of [0, 1] as const) {
    const w = p.peers[k].w;
    for (let i = 0; i < w.eventCount; i++) p.events[k].push({ ...w.events[i]! });
  }
  if (p.peers[0].w.ballAuth === 0 && p.peers[1].w.ballAuth === 1) p.doubleAuthTicks++;
  p.link.advance(TICK_MS);
}

/** 確定イベントログを比較用の文字列に（送り手・連番順） */
export function logKey(peer: NetPeer): string {
  return [...peer.log]
    .sort((a, b) => a.origin - b.origin || a.seq - b.seq)
    .map((e) => `${e.origin}#${e.seq} r${e.round} ${e.kind} s${e.side} v${e.value} hp${e.hp}`)
    .join('\n');
}
