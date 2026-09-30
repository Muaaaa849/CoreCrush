// M0: Pointer Lock（生入力 unadjustedMovement の対応確認と、マウス入力の頻度・粒度の観察）
// 回転角(度) = movementX × 感度 × 0.022（GDD 14.2）
const YAW_PER_COUNT = 0.022;

export interface PointerLockSnapshot {
  userAgent: string;
  unadjustedMovement: 'yes' | 'no' | 'unknown';
  locked: boolean;
  lockError?: string;
  pointerrawupdateAvailable: boolean;
  seconds: number;
  mousemovePerSec: number;
  pointerrawupdatePerSec: number;
  totalCountsX: number;
  yawDegAtSens1: number;
  maxAbsMovementXPerEvent: number;
}

export function mountPointerLockTest(target: HTMLElement): () => PointerLockSnapshot {
  const state = {
    unadjusted: 'unknown' as PointerLockSnapshot['unadjustedMovement'],
    lockError: undefined as string | undefined,
    locked: false,
    events: 0,
    rawEvents: 0,
    sumX: 0,
    maxAbsX: 0,
    startedAt: performance.now(),
    endedAt: 0,
  };

  async function lock(): Promise<void> {
    type Req = (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    try {
      await (target.requestPointerLock as Req)({ unadjustedMovement: true });
      state.unadjusted = 'yes';
    } catch (e) {
      state.unadjusted = 'no';
      try {
        await (target.requestPointerLock as Req)();
      } catch (e2) {
        state.lockError = String(e2);
      }
      if (!state.lockError) state.lockError = `unadjustedMovement: ${String(e)}`;
    }
  }

  target.addEventListener('click', () => void lock());
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === target;
    if (locked) Object.assign(state, { events: 0, rawEvents: 0, sumX: 0, maxAbsX: 0, startedAt: performance.now(), endedAt: 0 });
    else state.endedAt = performance.now();
    state.locked = locked;
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.events++;
    state.sumX += e.movementX;
    state.maxAbsX = Math.max(state.maxAbsX, Math.abs(e.movementX));
  });
  window.addEventListener('pointerrawupdate' as 'pointermove', () => {
    if (state.locked) state.rawEvents++;
  });

  return () => {
    const sec = Math.max(0.001, ((state.endedAt || performance.now()) - state.startedAt) / 1000);
    return {
      userAgent: navigator.userAgent,
      unadjustedMovement: state.unadjusted,
      locked: state.locked,
      ...(state.lockError ? { lockError: state.lockError } : {}),
      pointerrawupdateAvailable: 'onpointerrawupdate' in window,
      seconds: +sec.toFixed(2),
      mousemovePerSec: +(state.events / sec).toFixed(1),
      pointerrawupdatePerSec: +(state.rawEvents / sec).toFixed(1),
      totalCountsX: state.sumX,
      yawDegAtSens1: +(state.sumX * YAW_PER_COUNT).toFixed(2),
      maxAbsMovementXPerEvent: state.maxAbsX,
    };
  };
}
