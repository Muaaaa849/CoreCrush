// オンライン試合の開始: 役割 0 がシードを決めて hello を送り、両者が同じ条件で NetPeer を作る
import type { Balance, Stats } from '../sim/balance';
import type { Side } from '../sim/types';
import { NetPeer } from './peer';
import { decode, encodeHello } from './protocol';
import type { Channel, Transport } from './transport';

/** 先に読んでしまったメッセージを NetPeer に渡し直すための包み */
class Replay implements Transport {
  private held: ArrayBuffer[];
  constructor(private inner: Transport, held: ArrayBuffer[]) {
    this.held = held;
  }
  send(channel: Channel, data: ArrayBuffer): void {
    this.inner.send(channel, data);
  }
  poll(channel: Channel): ArrayBuffer[] {
    const got = this.inner.poll(channel);
    if (channel !== 'event' || this.held.length === 0) return got;
    const out = this.held.concat(got);
    this.held = [];
    return out;
  }
}

export interface OnlineMatchOptions {
  balance: Balance;
  role: Side;
  stats: [Stats, Stats];
  /** 役割 0 がシードを決めるための乱数（sim の外。省略時 crypto） */
  randomSeed?: () => number;
}

/** 役割 0 は即座に、役割 1 は hello を受け取ったら NetPeer を返す。poll を毎フレーム呼ぶ */
export function createMatchStarter(transport: Transport, opts: OnlineMatchOptions): { poll(): NetPeer | null } {
  if (opts.role === 0) {
    const seed = opts.randomSeed ? opts.randomSeed() : crypto.getRandomValues(new Uint32Array(1))[0]!;
    transport.send('event', encodeHello({ seed }));
    const peer = new NetPeer(opts.balance, { seed, stats: opts.stats, local: 0 }, transport);
    return { poll: () => peer };
  }
  let peer: NetPeer | null = null;
  return {
    poll() {
      if (peer) return peer;
      transport.poll('state'); // 開始前の状態は捨てる
      const got = transport.poll('event');
      const i = got.findIndex((b) => decode(b).type === 'hello');
      if (i < 0) return null;
      const m = decode(got[i]!);
      if (m.type !== 'hello') return null;
      peer = new NetPeer(opts.balance, { seed: m.hello.seed, stats: opts.stats, local: 1 }, new Replay(transport, got.slice(i + 1)));
      return peer;
    },
  };
}
