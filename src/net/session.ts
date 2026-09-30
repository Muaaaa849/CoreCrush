// オンライン対戦のセッション（1本の接続で何試合でも）。
// - 試合開始: 役割 0 がシードを決めて hello(試合番号, シード) を送り、両者が同じ条件で NetPeer を作る
// - 再戦: 両者が rematch(次の試合番号) を送ったら、役割 0 が次の hello を送る
// - 受信は全てここで受け、今の試合番号のものだけを NetPeer に渡す（前の試合の遅れて届いた分を捨てる）
import type { Balance, Stats } from '../sim/balance';
import type { Side } from '../sim/types';
import { NetPeer } from './peer';
import { decode, encodeHello, encodeRematch, peek } from './protocol';
import { Inbox, type Channel, type Transport } from './transport';

export interface OnlineMatchOptions {
  balance: Balance;
  role: Side;
  stats: [Stats, Stats];
  /** 役割 0 がシードを決めるための乱数（sim の外。省略時 crypto） */
  randomSeed?: () => number;
}

const CHANNELS: readonly Channel[] = ['event', 'state'];

export class OnlineSession {
  peer: NetPeer | null = null;
  /** 今の試合番号（-1 は開始前） */
  match = -1;
  /** 自分・相手が希望している次の試合番号（-1 は希望なし） */
  localWants = -1;
  remoteWants = -1;
  private inbox = new Inbox();
  private peerTransport: Transport;

  constructor(private raw: Transport, private opts: OnlineMatchOptions) {
    this.peerTransport = { send: (c, d) => raw.send(c, d), poll: (c) => this.inbox.poll(c) };
    if (opts.role === 0) this.hostStart(0);
  }

  get role(): Side {
    return this.opts.role;
  }

  private hostStart(match: number): void {
    const seed = this.opts.randomSeed ? this.opts.randomSeed() : crypto.getRandomValues(new Uint32Array(1))[0]!;
    this.raw.send('event', encodeHello(match, { seed }));
    this.begin(match, seed);
  }

  private begin(match: number, seed: number): void {
    this.match = match;
    this.localWants = this.remoteWants = -1;
    this.inbox = new Inbox();
    this.peer = new NetPeer(this.opts.balance, { seed, stats: this.opts.stats, local: this.opts.role, match }, this.peerTransport);
  }

  /** 毎 tick、peer.step の前に呼ぶ。新しい試合が始まったら true */
  pump(): boolean {
    let started = false;
    for (const ch of CHANNELS) {
      for (const buf of this.raw.poll(ch)) {
        const h = peek(buf);
        if (h.type === 'hello') {
          if (this.opts.role === 1 && h.match !== this.match) {
            const m = decode(buf);
            if (m.type === 'hello') {
              this.begin(h.match, m.hello.seed);
              started = true;
            }
          }
        } else if (h.type === 'rematch') {
          this.remoteWants = h.match;
        } else if (h.match === this.match) {
          this.inbox.push(ch, buf);
        }
      }
    }
    const next = (this.match + 1) & 0xff;
    if (this.opts.role === 0 && this.localWants === next && this.remoteWants === next) {
      this.hostStart(next);
      started = true;
    }
    return started;
  }

  /** 試合が終わったあと、再戦を希望する */
  requestRematch(): void {
    if (this.match < 0) return;
    const next = (this.match + 1) & 0xff;
    if (this.localWants === next) return;
    this.localWants = next;
    this.raw.send('event', encodeRematch(next));
  }
}
