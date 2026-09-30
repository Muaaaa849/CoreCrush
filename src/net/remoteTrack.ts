// 相手の位置の補間表示（GDD 11.3「相手の移動は100ms補間で表示」）。表示専用で、判定には使わない。
// 届いた状態を相手の tick で並べ、「相手の時計 − 補間遅延」の時刻を前後2点で補間する。
// 相手の時計は「届いた状態の相手 tick − 届いた時の自分の tick」の最大値（いちばん遅れの少ない到着）で推定する。
import netConfig from '../../data/net.json';

const CAPACITY = 64;
/** 時計のずれを推定する窓（自分の tick） */
const OFFSET_WINDOW_TICKS = 120;

export const REMOTE_INTERP_DELAY_F: number = netConfig.remoteInterpDelayF;

export class RemoteTrack {
  private tick = new Float64Array(CAPACITY);
  private x = new Float64Array(CAPACITY);
  private z = new Float64Array(CAPACITY);
  private count = 0;
  private head = 0; // 次に書く位置
  private offsets = new Float64Array(CAPACITY);
  private offsetAt = new Float64Array(CAPACITY);
  private newestTick = -Infinity;

  reset(): void {
    this.count = 0;
    this.head = 0;
    this.newestTick = -Infinity;
  }

  /** 状態が届いたら呼ぶ（冗長同梱の古いものも渡してよい。重複・逆順は捨てる） */
  push(remoteTick: number, x: number, z: number, localTick: number): void {
    if (remoteTick <= this.newestTick) return;
    this.newestTick = remoteTick;
    const i = this.head;
    this.tick[i] = remoteTick;
    this.x[i] = x;
    this.z[i] = z;
    this.offsets[i] = remoteTick - localTick;
    this.offsetAt[i] = localTick;
    this.head = (i + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
  }

  private offset(localTick: number): number {
    let best = -Infinity;
    for (let k = 0; k < this.count; k++) {
      if (localTick - this.offsetAt[k]! > OFFSET_WINDOW_TICKS) continue;
      if (this.offsets[k]! > best) best = this.offsets[k]!;
    }
    return best;
  }

  /**
   * 表示位置。localTick は自分の tick（描画の alpha を足した小数可）。点が足りなければ false。
   * 補間先が最新より新しいときは最新で止める（外挿しない）。
   */
  sample(localTick: number, delayTicks: number, out: { x: number; z: number }): boolean {
    if (this.count === 0) return false;
    const t = localTick + this.offset(Math.floor(localTick)) - delayTicks;
    // 新しい順に辿り、t を挟む2点を探す
    let newer = -1;
    for (let n = 0; n < this.count; n++) {
      const i = (this.head - 1 - n + CAPACITY) % CAPACITY;
      if (this.tick[i]! <= t) {
        if (newer < 0) {
          out.x = this.x[i]!;
          out.z = this.z[i]!;
          return true;
        }
        const k = (t - this.tick[i]!) / (this.tick[newer]! - this.tick[i]!);
        out.x = this.x[i]! + (this.x[newer]! - this.x[i]!) * k;
        out.z = this.z[i]! + (this.z[newer]! - this.z[i]!) * k;
        return true;
      }
      newer = i;
    }
    // すべて t より新しい（届き始め）: いちばん古い点
    out.x = this.x[newer]!;
    out.z = this.z[newer]!;
    return true;
  }
}
