// balance データの型と、ステータス・カウントの補正式。
// sim はこのモジュール経由でのみ数値を得る。数値そのものは data/ にある。

export type StepDir = 'front' | 'back' | 'left' | 'right';
export type ThrowTypeName = 'straight' | 'curveLeft' | 'curveRight' | 'lob' | 'aimed';

export interface ThrowTypeData {
  speedMps: number;
  lateralM: number;
  apexM: number;
  homing: boolean;
  evade: StepDir[];
}

export interface Balance {
  version: 1;
  tickHz: 60;
  court: { widthM: number; depthM: number; ceilingM: number; spawnFromCenterM: number; fenceClearanceM: number; trajectoryMarginM: number };
  player: {
    baseMoveMps: number; bodyRadiusM: number; bodyHeightM: number; chestHeightM: number; handHeightM: number; handForwardM: number;
    pickupRadiusM: number; pickupMaxHeightM: number; moveMulDuringWindup: number;
  };
  stats: {
    min: number; max: number; median: number; sumBase: number; sumMax: number;
    attackSpeedAddPerPoint: number; hpBase: number; hpPerDefensePoint: number;
    agilityMoveAddPerPoint: number; stepRecoverBaseSec: number; stepRecoverAddPerAgilityPoint: number;
  };
  count: {
    explodeSec: number; explosionDamage: number; roundStartFreezeSec: number; postExplosionFreezeSec: number;
    speedCurveAdd: number; powerCurveAdd: number;
    faceSec: { nervous: number; angry: number; blink: number; crack: number };
  };
  throw: {
    windupF: number; recoveryF: number; baseDamage: number; directionInputThreshold: number;
    types: Record<ThrowTypeName, ThrowTypeData>; aimedMaxRangeM: number;
  };
  fake: { cost: number };
  catch: {
    startupF: number; recoveryF: number; whiffStaggerF: number;
    windowByDefenseF: number[]; justByDefenseF: number[]; gain: number; justBonusGain: number;
  };
  parry: { startupF: number; windowF: number; recoveryF: number; whiffStaggerF: number; gain: number; rallySpeedMul: number };
  step: { distanceM: number; durationF: number; maxPoints: number; directionBoundaryDeg: number };
  hit: { reactionF: number };
  meter: { max: number };
  ball: { radiusM: number; gravityMps2: number; floorRestitution: number; maxBounceMps: number; wallRestitution: number; floorFrictionPerSec: number; restSpeedMps: number };
  round: { roundsToWin: number; interRoundSec: number };
  invariants: { fakeReactionBudgetF: number; fakeNetBudgetF: number; fakeGuaranteeDistanceM: number };
}

export interface Stats {
  attack: number;
  defense: number;
  agility: number;
}

/** 秒 → tick（四捨五入） */
export function secToTicks(b: Balance, sec: number): number {
  return Math.round(sec * b.tickHz);
}

export function dtSec(b: Balance): number {
  return 1 / b.tickHz;
}

// --- ステータス補正（GDD 6.1 の式） ---
export function attackSpeedMul(b: Balance, attack: number): number {
  return 1 + b.stats.attackSpeedAddPerPoint * (attack - b.stats.median);
}
export function maxHp(b: Balance, defense: number): number {
  return b.stats.hpBase + b.stats.hpPerDefensePoint * (defense - b.stats.median);
}
export function moveMul(b: Balance, agility: number): number {
  return 1 + b.stats.agilityMoveAddPerPoint * (agility - b.stats.median);
}
export function stepRecoverTicks(b: Balance, agility: number): number {
  return secToTicks(b, b.stats.stepRecoverBaseSec / (1 + b.stats.stepRecoverAddPerAgilityPoint * (agility - b.stats.median)));
}
/** キャッチ受付（防御参照。iron_grip 等の加算は bonusF） */
export function catchWindowF(b: Balance, defense: number, bonusF = 0): number {
  return (b.catch.windowByDefenseF[defense - 1] ?? 0) + bonusF;
}
/** ジャストキャッチ幅（キャッチ受付と同じく防御参照。Q-25） */
export function justWindowF(b: Balance, defense: number): number {
  return b.catch.justByDefenseF[defense - 1] ?? 0;
}

// --- カウント倍率（GDD 2.3）: t は投擲時のカウント秒 ---
export function countSpeedMul(b: Balance, tSec: number): number {
  const r = tSec / b.count.explodeSec;
  return 1 + b.count.speedCurveAdd * r * r;
}
export function countPowerMul(b: Balance, tSec: number): number {
  const r = tSec / b.count.explodeSec;
  return 1 + b.count.powerCurveAdd * r * r;
}
