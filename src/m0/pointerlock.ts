// M0: Pointer Lock（生入力 unadjustedMovement の対応確認と、マウス入力の頻度・粒度の観察）
// 回転角(度) = movementX × 感度 × 0.022（GDD 14.2）
const YAW_PER_COUNT = 0.022;

const out = document.getElementById('result') as HTMLPreElement;
const target = document.getElementById('target') as HTMLDivElement;

const state = {
  unadjustedSupported: 'unknown' as 'yes' | 'no' | 'unknown',
  locked: false,
  events: 0,
  rawEvents: 0,
  sumX: 0,
  sumY: 0,
  maxAbsX: 0,
  startedAt: 0,
  pointerrawupdate: 'onpointerrawupdate' in window,
};

async function lock(): Promise<void> {
  try {
    // 型定義に options が無い環境もあるためキャスト
    await (target.requestPointerLock as (o?: { unadjustedMovement?: boolean }) => Promise<void>)({ unadjustedMovement: true });
    state.unadjustedSupported = 'yes';
  } catch (e) {
    state.unadjustedSupported = 'no';
    console.warn('unadjustedMovement 非対応。通常ロックに切り替え', e);
    await (target.requestPointerLock as () => Promise<void> | void)();
  }
}

target.addEventListener('click', () => void lock());
document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === target;
  Object.assign(state, { events: 0, rawEvents: 0, sumX: 0, sumY: 0, maxAbsX: 0, startedAt: performance.now() });
});
document.addEventListener('mousemove', (e) => {
  if (!state.locked) return;
  state.events++;
  state.sumX += e.movementX;
  state.sumY += e.movementY;
  state.maxAbsX = Math.max(state.maxAbsX, Math.abs(e.movementX));
});
window.addEventListener('pointerrawupdate' as 'pointermove', () => {
  if (state.locked) state.rawEvents++;
});

function render(): void {
  const sec = Math.max(0.001, (performance.now() - state.startedAt) / 1000);
  out.textContent = JSON.stringify(
    {
      userAgent: navigator.userAgent,
      unadjustedMovement: state.unadjustedSupported,
      locked: state.locked,
      pointerrawupdateAvailable: state.pointerrawupdate,
      mousemovePerSec: +(state.events / sec).toFixed(1),
      pointerrawupdatePerSec: +(state.rawEvents / sec).toFixed(1),
      totalCountsX: state.sumX,
      yawDegAtSens1: +(state.sumX * YAW_PER_COUNT).toFixed(2),
      maxAbsMovementXPerEvent: state.maxAbsX,
    },
    null,
    2,
  );
  requestAnimationFrame(render);
}
render();
