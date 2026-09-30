// TPS / FPS カメラ（GDD 3.2、Q-10）。
// 切替は照準方向（yaw/pitch）を変えず、位置と FOV だけを補間する。非所持＝TPS、所持＝FPS。
import type { Balance } from '../sim/balance';
import type { Player } from '../sim/types';

export interface CameraSettings {
  sensitivity: number;
  fovTps: number;
  fovFps: number;
  adsZoom: number;
}

export const DEFAULT_CAMERA: CameraSettings = { sensitivity: 8.9, fovTps: 75, fovFps: 75, adsZoom: 0.8 };

/** GDD 14.2: 回転角(度) = movementX × 感度 × 0.022 */
export const DEG_PER_COUNT = 0.022;

const TPS_BACK_M = 2.2;
const TPS_UP_M = 0.35;
const TPS_SHOULDER_M = 0.45;
const HEAD_M = 1.7;
const EYE_M = 1.6;
const TO_FPS_MS = 150;
const TO_TPS_MS = 120;
const PITCH_LIMIT = (80 * Math.PI) / 180;

export class CameraRig {
  yaw = 0;
  pitch = 0;
  /** 0 = TPS, 1 = FPS */
  blend = 0;
  pos = { x: 0, y: 0, z: 0 };
  fov = 75;

  reset(side: 0 | 1): void {
    this.yaw = side === 0 ? 0 : Math.PI;
    this.pitch = -0.05;
    this.blend = 0;
  }

  look(dx: number, dy: number, s: CameraSettings): void {
    const k = (DEG_PER_COUNT * s.sensitivity * Math.PI) / 180;
    this.yaw -= dx * k;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy * k));
  }

  forward(out: { x: number; y: number; z: number }): typeof out {
    const c = Math.cos(this.pitch);
    out.x = Math.sin(this.yaw) * c;
    out.y = Math.sin(this.pitch);
    out.z = Math.cos(this.yaw) * c;
    return out;
  }

  /** 画面右（水平） */
  right(out: { x: number; y: number; z: number }): typeof out {
    out.x = -Math.cos(this.yaw);
    out.y = 0;
    out.z = Math.sin(this.yaw);
    return out;
  }

  static wantsFps(p: Player): boolean {
    // キャッチ成功は全フレーム終了後に FPS へ。投擲後は硬直が終わってから TPS へ（GDD 3.2）
    if (p.action === 'catchRecovery') return false;
    return p.holding || p.action === 'throwRecovery';
  }

  update(dtMs: number, p: { x: number; z: number }, wantFps: boolean, ads: boolean, s: CameraSettings, _b: Balance): void {
    const target = wantFps ? 1 : 0;
    const rate = dtMs / (wantFps ? TO_FPS_MS : TO_TPS_MS);
    this.blend = target > this.blend ? Math.min(1, this.blend + rate) : Math.max(0, this.blend - rate);
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    const f = this.forward({ x: 0, y: 0, z: 0 });
    const r = this.right({ x: 0, y: 0, z: 0 });
    const tps = {
      x: p.x - f.x * TPS_BACK_M + r.x * TPS_SHOULDER_M,
      y: HEAD_M + TPS_UP_M - f.y * TPS_BACK_M,
      z: p.z - f.z * TPS_BACK_M + r.z * TPS_SHOULDER_M,
    };
    const fps = { x: p.x, y: EYE_M, z: p.z };
    this.pos.x = tps.x + (fps.x - tps.x) * e;
    this.pos.y = tps.y + (fps.y - tps.y) * e;
    this.pos.z = tps.z + (fps.z - tps.z) * e;
    const base = s.fovTps + (s.fovFps - s.fovTps) * e;
    const goal = ads && wantFps ? base * s.adsZoom : base;
    this.fov += (goal - this.fov) * Math.min(1, dtMs / 80);
  }
}
