// 差し替え可能なトランスポート。実物は WebRTC DataChannel、テストは遅延注入つきのループバック（実ネットワークに依存しない）。
export type Channel = 'state' | 'event';

export interface Transport {
  send(channel: Channel, data: ArrayBuffer): void;
  /** 届いたメッセージを到着順に取り出す */
  poll(channel: Channel): ArrayBuffer[];
}

/** 受信を貯めて poll で渡す共通部品 */
export class Inbox {
  private q: Record<Channel, ArrayBuffer[]> = { state: [], event: [] };
  push(channel: Channel, data: ArrayBuffer): void {
    this.q[channel].push(data);
  }
  poll(channel: Channel): ArrayBuffer[] {
    const out = this.q[channel];
    this.q[channel] = [];
    return out;
  }
}
