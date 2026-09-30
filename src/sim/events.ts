// イベントは事前確保した配列を使い回す（試合中のアロケーション禁止）
import type { SimEvent, SimEventKind, Side, World } from './types';

export const EVENT_CAPACITY = 64;

export function createEventBuffer(): SimEvent[] {
  return Array.from({ length: EVENT_CAPACITY }, () => ({ tick: 0, kind: 'release' as SimEventKind, side: -1 as Side | -1, value: 0, label: '' }));
}

export function emit(w: World, kind: SimEventKind, side: Side | -1, value = 0, label = ''): void {
  if (w.eventCount >= w.events.length) throw new Error('sim: event buffer overflow');
  const e = w.events[w.eventCount++] as SimEvent;
  e.tick = w.tick;
  e.kind = kind;
  e.side = side;
  e.value = value;
  e.label = label;
}

/** この tick のイベントを列挙する（テスト・描画用） */
export function eventsOf(w: World): SimEvent[] {
  return w.events.slice(0, w.eventCount);
}
