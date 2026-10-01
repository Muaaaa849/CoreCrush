// 画面揺れ（GDD 3.2・render 規則: 最大 0.15 秒・小振幅、設定の強度 0〜100% を必ず掛ける）。
// 描画用カメラの位置と視線まわりの回転だけを揺らす。照準（CameraRig の yaw/pitch）は触らない。
// 数値は data/vfx/screenShake.json。試合中に new しない（出力は使い回しのオブジェクト）。
import shakeJson from '../../data/vfx/screenShake.json';

export type ShakeKind = 'hit' | 'explosion';
export interface ShakePreset { durationSec: number; amplitudeM: number; rollDeg: number; freqHz: number }
export interface ScreenShakeLook { defaultStrengthPct: number; presets: Record<ShakeKind, ShakePreset> }

export const SCREEN_SHAKE: ScreenShakeLook = shakeJson as ScreenShakeLook;

export interface ShakeOffset {
  /** カメラの右・上方向のずれ（m） */
  right: number;
  up: number;
  /** 視線を軸にした回転（ラジアン） */
  roll: number;
}

export class ScreenShake {
  /** 設定の強度（0〜1） */
  strength: number;
  private startSec = -1;
  private preset: ShakePreset | null = null;
  private amp = 0;
  private readonly out: ShakeOffset = { right: 0, up: 0, roll: 0 };

  constructor(private readonly look: ScreenShakeLook = SCREEN_SHAKE) {
    this.strength = look.defaultStrengthPct / 100;
  }

  /** 揺れを始める。揺れている途中なら強い方を残す */
  trigger(kind: ShakeKind, nowSec: number): void {
    const p = this.look.presets[kind];
    const cur = this.preset ? this.amp * this.envelope(nowSec) : 0;
    if (cur > p.amplitudeM) return;
    this.preset = p;
    this.amp = p.amplitudeM;
    this.startSec = nowSec;
  }

  private envelope(nowSec: number): number {
    if (!this.preset) return 0;
    const k = (nowSec - this.startSec) / this.preset.durationSec;
    if (k < 0 || k >= 1) return 0;
    return (1 - k) * (1 - k);
  }

  /** 今のずれ（揺れていなければ全て 0）。返すオブジェクトは使い回し */
  sample(nowSec: number): ShakeOffset {
    const o = this.out;
    const p = this.preset;
    const e = this.envelope(nowSec) * Math.min(Math.max(this.strength, 0), 1);
    if (!p || e <= 0) {
      o.right = o.up = o.roll = 0;
      return o;
    }
    // 周波数の違う正弦の和（乱数を使わず、毎回同じ揺れ方）
    const t = (nowSec - this.startSec) * Math.PI * 2 * p.freqHz;
    o.right = this.amp * e * (Math.sin(t) * 0.7 + Math.sin(t * 1.73 + 1.3) * 0.3);
    o.up = this.amp * e * (Math.sin(t * 1.21 + 0.6) * 0.7 + Math.sin(t * 2.31 + 2.1) * 0.3);
    o.roll = ((p.rollDeg * Math.PI) / 180) * e * Math.sin(t * 0.83 + 0.4);
    return o;
  }
}
