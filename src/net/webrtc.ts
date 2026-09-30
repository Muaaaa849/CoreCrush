// WebRTC DataChannel のトランスポートと接続手順（GDD 11.1, 11.2）。
// - シグナリング: workers/signaling の部屋（WebSocket）で SDP/ICE を交換するだけ
// - state: 非信頼・順不同（ordered:false, maxRetransmits:0） / event: 信頼・順序保証
// - 両者が同じ id でチャネルを作る（negotiated）ので ondatachannel を待たない
import type { Side } from '../sim/types';
import { Inbox, type Channel, type Transport } from './transport';

export type ConnectStatus = 'ice' | 'signaling' | 'waiting' | 'negotiating' | 'open';

export interface ConnectOptions {
  /** シグナリング Worker の URL（https://… または http://localhost:8787） */
  serverUrl: string;
  room: string;
  onStatus?: (s: ConnectStatus) => void;
  timeoutMs?: number;
}

export class WebRtcTransport implements Transport {
  private inbox = new Inbox();
  closed = false;
  onClose: (() => void) | null = null;

  constructor(readonly pc: RTCPeerConnection, private state: RTCDataChannel, private event: RTCDataChannel) {
    for (const [ch, name] of [[state, 'state'], [event, 'event']] as const) {
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.inbox.push(name, e.data);
      };
      ch.onclose = () => this.handleClose();
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.handleClose();
    };
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }

  send(channel: Channel, data: ArrayBuffer): void {
    const ch = channel === 'state' ? this.state : this.event;
    if (ch.readyState !== 'open') return;
    // 非信頼チャネルは詰まっていたら捨てる（古い状態を送っても意味がない）
    if (channel === 'state' && ch.bufferedAmount > 64 * 1024) return;
    ch.send(data);
  }

  poll(channel: Channel): ArrayBuffer[] {
    return this.inbox.poll(channel);
  }

  close(): void {
    this.state.close();
    this.event.close();
    this.pc.close();
  }
}

async function fetchIceServers(serverUrl: string): Promise<RTCIceServer[]> {
  try {
    const r = await fetch(new URL('/ice', serverUrl), { method: 'POST' });
    if (r.ok) return ((await r.json()) as { iceServers: RTCIceServer[] }).iceServers;
  } catch {
    // シグナリングに届かない場合は下の STUN だけで続ける（部屋への接続で失敗が分かる）
  }
  return [{ urls: ['stun:stun.cloudflare.com:3478'] }];
}

type Signal =
  | { type: 'joined'; role: Side; peers: number }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'full' }
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

/** 部屋に入り、相手と DataChannel をつなぐ。役割 0 が offer を出す */
export async function connect(opts: ConnectOptions): Promise<{ transport: WebRtcTransport; role: Side }> {
  const status = opts.onStatus ?? (() => {});
  status('ice');
  const iceServers = await fetchIceServers(opts.serverUrl);
  status('signaling');
  const wsUrl = new URL(`/room/${encodeURIComponent(opts.room.toUpperCase())}`, opts.serverUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    let pc: RTCPeerConnection | null = null;
    let role: Side = 0;
    let stateCh: RTCDataChannel | null = null;
    let eventCh: RTCDataChannel | null = null;
    const early: RTCIceCandidateInit[] = [];
    let done = false;
    const timer = setTimeout(() => fail(new Error('接続がタイムアウトしました')), opts.timeoutMs ?? 30000);

    function fail(e: Error): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      pc?.close();
      reject(e);
    }
    const send = (m: Signal) => ws.send(JSON.stringify(m));

    function makePc(): RTCPeerConnection {
      const p = new RTCPeerConnection({ iceServers });
      p.onicecandidate = (e) => {
        if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() });
      };
      stateCh = p.createDataChannel('state', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
      eventCh = p.createDataChannel('event', { negotiated: true, id: 1 });
      let opened = 0;
      const onOpen = () => {
        if (++opened < 2 || done) return;
        done = true;
        clearTimeout(timer);
        ws.close(); // つながったらシグナリングは不要
        status('open');
        resolve({ transport: new WebRtcTransport(p, stateCh!, eventCh!), role });
      };
      stateCh.onopen = onOpen;
      eventCh.onopen = onOpen;
      return p;
    }

    async function flushEarly(): Promise<void> {
      for (const c of early.splice(0)) await pc!.addIceCandidate(c);
    }

    ws.onerror = () => fail(new Error('シグナリングサーバーに接続できません'));
    ws.onmessage = async (e) => {
      const m = JSON.parse(String(e.data)) as Signal;
      try {
        switch (m.type) {
          case 'full':
            fail(new Error('この部屋は満員です'));
            return;
          case 'joined':
            role = m.role;
            status('waiting');
            return;
          case 'peer-joined':
            if (role !== 0) return;
            status('negotiating');
            pc?.close();
            pc = makePc();
            await pc.setLocalDescription(await pc.createOffer());
            send({ type: 'offer', sdp: pc.localDescription!.sdp });
            return;
          case 'offer':
            status('negotiating');
            pc?.close();
            pc = makePc();
            await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
            await flushEarly();
            await pc.setLocalDescription(await pc.createAnswer());
            send({ type: 'answer', sdp: pc.localDescription!.sdp });
            return;
          case 'answer':
            await pc?.setRemoteDescription({ type: 'answer', sdp: m.sdp });
            await flushEarly();
            return;
          case 'ice':
            if (pc?.remoteDescription) await pc.addIceCandidate(m.candidate);
            else early.push(m.candidate);
            return;
          case 'peer-left':
            if (!done) status('waiting');
            return;
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    };
  });
}
