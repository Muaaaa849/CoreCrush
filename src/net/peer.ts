// 通信対戦の1台分。自分側の World を固定 60Hz で進め、確定イベントと状態を送り、相手のものを反映する。
// net 層は運搬と権威の受け渡しだけ。判定は sim（src/sim/judge）で行う（netcode 規則）。
import type { Balance } from '../sim/balance';
import {
  applyAuthEvent, applyRemoteState, captureBall, captureState, createBallWire, isAuthoritative,
  type AuthEvent, type RemoteState,
} from '../sim/judge/remote';
import { NO_INPUT, type PlayerInput, type Side, type World } from '../sim/types';
import { createWorld, stepWorld, type WorldOptions } from '../sim/world';
import { STATE_REDUNDANCY, decode, encodeEvent, encodeState, plausibleEvent } from './protocol';
import type { Transport } from './transport';

export interface PeerOptions extends Omit<WorldOptions, 'local'> {
  local: Side;
}

/** 確定イベントログの1行（両クライアントで一致すること。GDD 11.3 必須テスト） */
export interface LogEntry {
  origin: Side;
  seq: number;
  round: number;
  kind: string;
  side: number;
  value: number;
  hp: number;
}

const MAX_PLAUSIBLE_SPEED_MPS = 1e5;

export class NetPeer {
  readonly w: World;
  readonly local: Side;
  readonly remote: Side;
  readonly log: LogEntry[] = [];
  /** 相手のイベントのうち、まだ反映していないもの（ラウンドの先行分） */
  private pendingEvents: AuthEvent[] = [];
  private nextRemoteSeq = 0;
  private seq = 0;
  private sentStates: RemoteState[] = [];
  private lastRemoteStateTick = -1;
  private inputs: [PlayerInput, PlayerInput] = [NO_INPUT, NO_INPUT];

  constructor(balance: Balance, opts: PeerOptions, private transport: Transport) {
    this.local = opts.local;
    this.remote = opts.local === 0 ? 1 : 0;
    this.w = createWorld(balance, { ...opts, local: opts.local });
  }

  /** 1 tick 進める。戻り値のイベントはこの tick に起きたもの（自分の判定＋相手から届いた確定） */
  step(input: PlayerInput): void {
    const w = this.w;
    this.inputs[this.local] = input;
    this.inputs[this.remote] = NO_INPUT;
    stepWorld(w, this.inputs);

    // 自分が判定権を持って確定させたイベントを送る（反映より前に集める）
    const n = w.eventCount;
    for (let i = 0; i < n; i++) {
      const e = w.events[i]!;
      if (!isAuthoritative(w, e)) continue;
      const hp = e.kind === 'hit' || e.kind === 'explosion' ? w.players[e.side === -1 ? 0 : e.side].hp : NaN;
      const ev: AuthEvent = {
        seq: this.seq++, tick: w.tick, round: w.round, kind: e.kind, side: e.side, value: e.value, hp,
        ballAuth: w.ballAuth, ball: captureBall(w, createBallWire()),
      };
      this.transport.send('event', encodeEvent(ev));
      this.record(this.local, ev);
    }

    // 状態（直近を冗長同梱）
    this.sentStates.unshift(captureState(w, {} as RemoteState));
    if (this.sentStates.length > STATE_REDUNDANCY) this.sentStates.length = STATE_REDUNDANCY;
    this.transport.send('state', encodeState(this.sentStates));

    this.receive();
  }

  private record(origin: Side, ev: AuthEvent): void {
    this.log.push({ origin, seq: ev.seq, round: ev.round, kind: ev.kind, side: ev.side, value: ev.value, hp: ev.hp });
  }

  private receive(): void {
    const w = this.w;
    for (const buf of this.transport.poll('event')) {
      const m = decode(buf);
      if (m.type !== 'event') continue;
      const ev = m.event;
      if (ev.seq !== this.nextRemoteSeq) throw new Error(`net: event seq ${ev.seq} != ${this.nextRemoteSeq}（信頼チャネルの順序が壊れた）`);
      this.nextRemoteSeq++;
      this.record(this.remote, ev);
      if (!plausibleEvent(ev, MAX_PLAUSIBLE_SPEED_MPS)) continue;
      this.pendingEvents.push(ev);
    }
    // 同じラウンドの対戦中だけ反映。古いラウンドは捨て、先のラウンドはこちらが追いつくまで待つ
    while (this.pendingEvents.length > 0) {
      const ev = this.pendingEvents[0]!;
      if (ev.round < w.round || w.phase === 'matchOver') {
        this.pendingEvents.shift();
        continue;
      }
      if (ev.round > w.round || w.phase !== 'play') break;
      this.pendingEvents.shift();
      applyAuthEvent(w, ev);
    }

    let newest: RemoteState | null = null;
    for (const buf of this.transport.poll('state')) {
      const m = decode(buf);
      if (m.type !== 'state') continue;
      for (const s of m.states) if (s.tick > this.lastRemoteStateTick && (!newest || s.tick > newest.tick)) newest = s;
    }
    if (newest && newest.round === w.round && w.phase === 'play') {
      this.lastRemoteStateTick = newest.tick;
      applyRemoteState(w, newest);
    }
  }
}
