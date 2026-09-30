// 画質段階（高・中・低＋自動。Q-31 回答、GDD 12.3）。数値は data/quality.json。
// 描画側はここで決まった QualityPreset と描画解像度だけを見る。
import qualityJson from '../../data/quality.json';

export type QualityTier = 'high' | 'mid' | 'low';
export type QualitySetting = 'auto' | QualityTier;

export interface QualityPreset {
  /** 描画解像度の上限（端末の倍率とこの小さい方） */
  pixelRatioMax: number;
  /** ブルームの解像度倍率。0 はブルームなし */
  bloomScale: number;
  /** 影マップの一辺。0 は影なし（丸影） */
  shadowMapSize: number;
  smaa: boolean;
  particleMul: number;
  decorMul: number;
}

export interface QualityConfig {
  defaultTouch: QualityTier;
  defaultDesktop: QualityTier;
  presets: Record<QualityTier, QualityPreset>;
  auto: { overFrameMs: number; windowF: number; dropOverPct: number; scaleSteps: number[] };
}

export const QUALITY: QualityConfig = qualityJson as QualityConfig;

export const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'high', 'mid', 'low'];

export function parseQualitySetting(v: unknown): QualitySetting {
  return QUALITY_SETTINGS.includes(v as QualitySetting) ? (v as QualitySetting) : 'auto';
}

/** 設定から使う段階を決める。自動は端末の既定（タッチ端末は中、PC は高）から始める */
export function resolveTier(setting: QualitySetting, touch: boolean, cfg: QualityConfig = QUALITY): QualityTier {
  if (setting !== 'auto') return setting;
  return touch ? cfg.defaultTouch : cfg.defaultDesktop;
}

/** 描画解像度（CSS px あたりの描画 px）。scale は自動の段階的低下の倍率 */
export function pixelRatioFor(preset: QualityPreset, devicePixelRatio: number, scale = 1): number {
  return Math.min(devicePixelRatio, preset.pixelRatioMax) * scale;
}

/**
 * 画質「自動」の描画解像度の段階的低下。
 * windowF フレームごとに、overFrameMs を超えたフレームの割合が dropOverPct 以上なら 1 段下げる。
 * 60Hz 表示ではフレーム間隔が 16.7ms を下回らず余裕を測れないので、上げ戻しはしない（設定の変更・reset で戻る）。
 * 段階を変えた直後の窓は捨てる（解像度変更そのものの引っかかりで連続して下げないため）。
 */
export class AutoResolution {
  private step = 0;
  private frames = 0;
  private over = 0;
  private skipWindow = false;

  constructor(private readonly cfg: QualityConfig['auto'] = QUALITY.auto) {}

  get scale(): number {
    return this.cfg.scaleSteps[this.step]!;
  }

  get atFloor(): boolean {
    return this.step >= this.cfg.scaleSteps.length - 1;
  }

  reset(): void {
    this.step = 0;
    this.frames = 0;
    this.over = 0;
    this.skipWindow = false;
  }

  /** 1 フレームぶんの間隔を入れる。倍率が変わったら true */
  push(frameMs: number): boolean {
    this.frames++;
    if (frameMs > this.cfg.overFrameMs) this.over++;
    if (this.frames < this.cfg.windowF) return false;
    const slow = (100 * this.over) / this.frames >= this.cfg.dropOverPct;
    const skip = this.skipWindow;
    this.frames = 0;
    this.over = 0;
    this.skipWindow = false;
    if (skip || !slow || this.atFloor) return false;
    this.step++;
    this.skipWindow = true;
    return true;
  }
}
