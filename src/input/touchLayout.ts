// スマホ（横持ち）のタッチ操作の配置と、スティックの計算。DOM に依存しない（テスト可能）。
// 位置は画面の幅・高さに対する割合（中心点）、大きさは画面の短辺に対する割合（直径）で持つので、機種が変わっても崩れない。

/** 配置できる操作部品。所持時と非所持時で出すものが違う */
export type TouchControlId =
  | 'stick'
  | 'throw'
  | 'aim'
  | 'fake'
  | 'parry'
  | 'catch'
  | 'step'
  | 'skill1'
  | 'skill2'
  | 'summon'
  | 'pause';

export const TOUCH_CONTROL_IDS: readonly TouchControlId[] = [
  'stick', 'throw', 'aim', 'fake', 'parry', 'catch', 'step', 'skill1', 'skill2', 'summon', 'pause',
];

export const TOUCH_LABELS: Record<TouchControlId, string> = {
  stick: '移動',
  throw: '投げる',
  aim: '狙い',
  fake: 'フリ',
  parry: '跳ね返し',
  catch: 'キャッチ',
  step: 'ステップ',
  skill1: 'スキル1',
  skill2: 'スキル2',
  summon: '球召喚',
  pause: '一時停止',
};

/** ボールの所持状態ごとに出す部品（スキルは装備しているときだけ。main 側で絞る） */
export const HOLDING_CONTROLS: readonly TouchControlId[] = ['stick', 'throw', 'aim', 'fake', 'step', 'skill1', 'skill2', 'summon', 'pause'];
export const EMPTY_CONTROLS: readonly TouchControlId[] = ['stick', 'parry', 'catch', 'step', 'skill1', 'skill2', 'summon', 'pause'];

export interface ControlPlacement {
  /** 中心の x（画面幅に対する割合 0〜1） */
  x: number;
  /** 中心の y（画面高さに対する割合 0〜1） */
  y: number;
  /** 直径（画面の短辺に対する割合） */
  size: number;
}

export interface TouchLayout {
  version: 1;
  /** 部品の不透明度 0.2〜1 */
  opacity: number;
  /** 視点ドラッグの感度（度 / CSS px） */
  lookDegPerPx: number;
  /** true: 左側のどこを触ってもそこがスティックの中心になる */
  stickFloating: boolean;
  controls: Record<TouchControlId, ControlPlacement>;
}

export const SIZE_MIN = 0.08;
export const SIZE_MAX = 0.6;
export const OPACITY_MIN = 0.2;
export const LOOK_MIN = 0.05;
export const LOOK_MAX = 1.5;

// 右手側の配置: キーボードの「左クリック＝投げる／跳ね返し」「右クリック＝狙い／キャッチ」と同じ位置関係にそろえる
export const DEFAULT_TOUCH_LAYOUT: TouchLayout = {
  version: 1,
  opacity: 0.75,
  lookDegPerPx: 0.25,
  stickFloating: false,
  controls: {
    stick: { x: 0.16, y: 0.7, size: 0.4 },
    throw: { x: 0.88, y: 0.72, size: 0.26 },
    parry: { x: 0.88, y: 0.72, size: 0.26 },
    aim: { x: 0.73, y: 0.82, size: 0.19 },
    catch: { x: 0.73, y: 0.82, size: 0.22 },
    fake: { x: 0.93, y: 0.43, size: 0.17 },
    step: { x: 0.76, y: 0.55, size: 0.19 },
    skill1: { x: 0.6, y: 0.86, size: 0.16 },
    skill2: { x: 0.62, y: 0.63, size: 0.16 },
    summon: { x: 0.8, y: 0.3, size: 0.14 },
    pause: { x: 0.045, y: 0.1, size: 0.12 },
  },
};

export function cloneLayout(l: TouchLayout): TouchLayout {
  const controls = {} as Record<TouchControlId, ControlPlacement>;
  for (const id of TOUCH_CONTROL_IDS) controls[id] = { ...l.controls[id] };
  return { ...l, controls };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function clampPlacement(p: ControlPlacement): ControlPlacement {
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), size: clamp(p.size, SIZE_MIN, SIZE_MAX) };
}

/** 保存値（壊れている・古い・部品が足りない）を読み、足りないところは既定値で埋める */
export function parseLayout(raw: unknown): TouchLayout {
  const out = cloneLayout(DEFAULT_TOUCH_LAYOUT);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<Record<keyof TouchLayout, unknown>>;
  out.opacity = clamp(num(r.opacity, out.opacity), OPACITY_MIN, 1);
  out.lookDegPerPx = clamp(num(r.lookDegPerPx, out.lookDegPerPx), LOOK_MIN, LOOK_MAX);
  if (typeof r.stickFloating === 'boolean') out.stickFloating = r.stickFloating;
  const c = r.controls;
  if (c && typeof c === 'object') {
    for (const id of TOUCH_CONTROL_IDS) {
      const p = (c as Record<string, unknown>)[id];
      if (!p || typeof p !== 'object') continue;
      const q = p as Partial<Record<keyof ControlPlacement, unknown>>;
      const d = out.controls[id];
      out.controls[id] = clampPlacement({ x: num(q.x, d.x), y: num(q.y, d.y), size: num(q.size, d.size) });
    }
  }
  return out;
}

/**
 * スティックの出力。中心からのずれ（px、画面の下向きが +dy）を、右＝+x・前（上）＝+y の [-1, 1] に直す。
 * 半径の外は 1 に切り詰め、デッドゾーン内は 0、デッドゾーンの外は 0 から立ち上がるように詰め直す。
 */
export function stickVector(dx: number, dy: number, radius: number, deadzone: number, out: { x: number; y: number }): typeof out {
  const len = Math.hypot(dx, dy);
  if (radius <= 0 || len <= radius * deadzone) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const mag = Math.min(1, (len / radius - deadzone) / (1 - deadzone));
  out.x = (dx / len) * mag;
  out.y = (-dy / len) * mag;
  return out;
}
