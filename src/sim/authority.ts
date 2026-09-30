// ボールの判定権（受け手権威。GDD 11.3）。オフラインでも同じ規則で追跡し、通信対戦では判定の可否に使う。
// - 飛翔中: 受け手 / 所持中: 持っている側 / 転がり中: 判定権を持つ側（コートを出たら受け渡し）/ 爆発後: 新球の側
import type { World } from './types';

/** この World がボールを判定してよいか（オフラインは常に真。通信対戦は判定権を持つ側だけ） */
export function hasBallAuthority(w: World): boolean {
  return w.local === -1 || w.ballAuth === w.local;
}
