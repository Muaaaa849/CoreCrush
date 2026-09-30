// sim の状態型。描画・ネットはこれを読むだけ。
import type { Balance, Stats, StepDir, ThrowTypeName } from './balance';
import type { Vec3 } from './math';
import type { Rng } from './rng';

export type Side = 0 | 1;

/** 1 tick 分の入力。移動はコート基準（前＝相手コート方向）。ボタンは「押した瞬間」 */
export interface PlayerInput {
  moveRight: number;
  moveForward: number;
  primary: boolean;
  secondary: boolean;
  secondaryHeld: boolean;
  fake: boolean;
  step: boolean;
  /** 狙い投げの方向（ワールド）。null なら相手の胸へ */
  aimDir: Vec3 | null;
}

export const NO_INPUT: Readonly<PlayerInput> = Object.freeze({
  moveRight: 0,
  moveForward: 0,
  primary: false,
  secondary: false,
  secondaryHeld: false,
  fake: false,
  step: false,
  aimDir: null,
});

export type Action =
  | 'idle'
  | 'windup'
  | 'fakeWindup'
  | 'throwRecovery'
  | 'fakeRecovery'
  | 'catch'
  | 'catchRecovery'
  | 'parry'
  | 'parryRecovery'
  | 'stagger'
  | 'step'
  | 'hitReaction';

export interface StepDirs {
  front: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface Player {
  side: Side;
  stats: Stats;
  /** 足元の位置 */
  pos: Vec3;
  hp: number;
  maxHp: number;
  meter: number;
  stepPoints: number;
  stepRecoverProgress: number;
  action: Action;
  /** 現在の行動を始めてからの tick 数（開始 tick が 0） */
  actionTick: number;
  /** 現在の行動の長さ（tick）。0 は無期限 */
  actionLength: number;
  holding: boolean;
  /** キャッチ受付への加算（iron_grip 等） */
  catchBonusF: number;
  stepFrom: Vec3;
  stepTo: Vec3;
  stepDirs: StepDirs;
  wins: number;
  /** 直近の入力（投擲の球種判定に使う） */
  input: PlayerInput;
}

export type BallMode = 'held' | 'flight' | 'linear' | 'loose';
export type FlightKind = ThrowTypeName | 'parry';

export interface Ball {
  mode: BallMode;
  holder: Side | -1;
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  /** 今いるコート（中央線で判定） */
  side: Side;
  countTicks: number;
  freezeTicks: number;
  // --- 飛翔（flight / linear） ---
  thrower: Side;
  receiver: Side;
  kind: FlightKind;
  speedMps: number;
  powerMul: number;
  start: Vec3;
  target: Vec3;
  u: number;
  lateralM: number;
  apexM: number;
  homing: boolean;
  /** 有効方向ステップで追尾解除された球は受け手に当たらない（OPEN: Q-29） */
  evaded: boolean;
  evade: StepDirs;
  /** 跳ね返しの連続回数（ラリー） */
  rally: number;
  // --- loose ---
  bounces: number;
}

export type Phase = 'play' | 'roundEnd' | 'matchOver';

export type SimEventKind =
  | 'release'
  | 'fakeStart'
  | 'catch'
  | 'justCatch'
  | 'parry'
  | 'whiffCatch'
  | 'whiffParry'
  | 'hit'
  | 'miss'
  | 'explosion'
  | 'step'
  | 'homingCancelled'
  | 'pickup'
  | 'cross'
  | 'roundStart'
  | 'roundEnd'
  | 'matchEnd';

export interface SimEvent {
  tick: number;
  kind: SimEventKind;
  side: Side | -1;
  value: number;
  label: string;
}

export interface World {
  balance: Balance;
  tick: number;
  rng: Rng;
  phase: Phase;
  phaseTicks: number;
  round: number;
  players: [Player, Player];
  ball: Ball;
  /** この tick に起きたイベント（毎 tick 先頭でクリア。要素は使い回す） */
  events: SimEvent[];
  eventCount: number;
}
