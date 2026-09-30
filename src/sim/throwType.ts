// 移動入力から球種を決める（投擲と跳ね返しで共通）
import type { Balance, ThrowTypeName } from './balance';
import type { PlayerInput } from './types';

/**
 * Q-09 提案: 後ろ入力＝上カーブ ＞ 左右の片方＝左右カーブ ＞ それ以外＝ストレート。
 * allowAimed=false（跳ね返し）では右ボタン保持を無視する。
 */
export function throwTypeFromInput(b: Balance, input: PlayerInput, allowAimed = true): ThrowTypeName {
  const th = b.throw.directionInputThreshold;
  if (allowAimed && input.secondaryHeld) return 'aimed';
  const right = input.keyRight ?? input.moveRight;
  const forward = input.keyForward ?? input.moveForward;
  if (forward <= -th) return 'lob';
  if (right <= -th) return 'curveLeft';
  if (right >= th) return 'curveRight';
  return 'straight';
}
