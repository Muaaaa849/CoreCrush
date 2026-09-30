// 遅延注入つきのループバック（GDD 11.3 必須テスト: RTT 0/80/160ms × ロス 0/2/5%）。
// - state（非信頼・順不同）: ロスで捨てる。ジッタで順序が入れ替わりうる
// - event（信頼・順序保証）: ロスは再送遅延（RTO）として表し、先頭詰まり（head-of-line blocking）も再現する
import { createRng, nextFloat, type Rng } from '../sim/rng';
import { Inbox, type Channel, type Transport } from './transport';

export interface LinkOptions {
  rttMs: number;
  loss: number;
  /** 片道遅延の揺れ（±ms、一様） */
  jitterMs?: number;
  seed?: number;
}

interface InFlight {
  at: number;
  channel: Channel;
  data: ArrayBuffer;
}

class Endpoint implements Transport {
  readonly inbox = new Inbox();
  peer!: Endpoint;
  lastEventAt = 0;
  constructor(private link: LoopbackLink) {}
  send(channel: Channel, data: ArrayBuffer): void {
    this.link.enqueue(this, channel, data);
  }
  poll(channel: Channel): ArrayBuffer[] {
    return this.inbox.poll(channel);
  }
}

export class LoopbackLink {
  readonly a: Endpoint;
  readonly b: Endpoint;
  private now = 0;
  private rng: Rng;
  private queue: { to: Endpoint; m: InFlight }[] = [];
  /** 統計（テスト用） */
  sent = { state: 0, event: 0 };
  dropped = 0;

  constructor(private opts: LinkOptions) {
    this.rng = createRng(opts.seed ?? 1);
    this.a = new Endpoint(this);
    this.b = new Endpoint(this);
    this.a.peer = this.b;
    this.b.peer = this.a;
  }

  enqueue(from: Endpoint, channel: Channel, data: ArrayBuffer): void {
    const to = from.peer;
    const oneWay = this.opts.rttMs / 2;
    const jitter = this.opts.jitterMs ? (nextFloat(this.rng) * 2 - 1) * this.opts.jitterMs : 0;
    let at = this.now + Math.max(0, oneWay + jitter);
    this.sent[channel]++;
    const lost = nextFloat(this.rng) < this.opts.loss;
    if (channel === 'state') {
      if (lost) {
        this.dropped++;
        return;
      }
    } else {
      // 信頼チャネル: 失われたら RTO 後に再送（SCTP の最小 RTO 相当として max(200ms, 2·RTT)）
      if (lost) at += Math.max(200, this.opts.rttMs * 2);
      at = Math.max(at, to.lastEventAt);
      to.lastEventAt = at;
    }
    this.queue.push({ to, m: { at, channel, data: data.slice(0) } });
  }

  /** 時間を進め、到着したものを受信箱へ */
  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((q) => q.m.at <= this.now).sort((x, y) => x.m.at - y.m.at);
    if (due.length === 0) return;
    this.queue = this.queue.filter((q) => q.m.at > this.now);
    for (const q of due) q.to.inbox.push(q.m.channel, q.m.data);
  }
}
