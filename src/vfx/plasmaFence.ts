// プラズマ・フェンス（GDD 1・13 章）。プランナー指示（2026-10-01）: ノイズの放電は入れない。球が見えることが最優先。
// - 向こう側の景色を滑らかな波でうっすら歪める（画面の色を読み直して UV をずらす）
// - 一定間隔で、電気の色の薄い帯が端から端へ流れる
// - 球の通過・人が触れたときは薄い波紋（uniform 4 つを使い回す。試合中に new しない）
// 色づきは全てブルームのしきい値よりずっと弱い（スキーマで上限 0.3）。数値は data/vfx/plasmaFence.json。
import * as THREE from 'three/webgpu';
import { clamp, color, cos, exp, float, fract, positionWorld, screenUV, sin, smoothstep, uniform, vec2, viewportSharedTexture } from 'three/tsl';
import fenceJson from '../../data/vfx/plasmaFence.json';

export interface PlasmaFenceLook {
  heightM: number;
  tintColor: string;
  baseHdr: number;
  topFadeM: number;
  pulse: { periodSec: number; speedMps: number; widthM: number; hdr: number };
  distortion: { amount: number; waveM: number; speed: number };
  ripple: { max: number; speedMps: number; widthM: number; lifeSec: number; crossHdr: number; touchHdr: number; touchCooldownSec: number };
}

export const PLASMA_FENCE: PlasmaFenceLook = fenceJson as PlasmaFenceLook;

export class PlasmaFence {
  readonly mesh: THREE.Mesh;
  private readonly now = uniform(0);
  /** 波紋: (x, y, 開始時刻, 強さ)。強さ 0 は空き */
  private readonly ripples: { value: THREE.Vector4 }[] = [];
  private next = 0;
  private nowSec = 0;
  private lastTouch = [-1e9, -1e9];

  constructor(widthM: number, private readonly look: PlasmaFenceLook = PLASMA_FENCE) {
    const L = look;
    const H = L.heightM;
    const p = positionWorld;
    const t = this.now;
    const fade = float(1).sub(smoothstep(H - L.topFadeM, H, p.y)).mul(smoothstep(0, 0.15, p.y));

    // うっすら歪む: 2 方向の滑らかな波で画面の UV をずらし、向こう側の色を読む
    const D = L.distortion;
    const k = (Math.PI * 2) / D.waveM;
    const wave = vec2(
      sin(p.y.mul(k).add(t.mul(D.speed * 2.3)).add(p.x.mul(k * 0.37))),
      cos(p.x.mul(k).sub(t.mul(D.speed * 1.7)).add(p.y.mul(k * 0.29))),
    ).mul(D.amount).mul(fade);
    const behind = viewportSharedTexture(screenUV.add(wave)).rgb;

    // 定期的な波紋: 片端から反対の端へ横に流れる薄い帯（中央に留まって相手や球に重ならないように）
    const P = L.pulse;
    const age = fract(t.div(P.periodSec)).mul(P.periodSec);
    const front = p.x.add(widthM / 2 + P.widthM * 2).sub(age.mul(P.speedMps)).div(P.widthM);
    const pulse = exp(front.mul(front).negate()).mul(P.hdr);

    // 出来事の波紋（球の通過・人が触れた）
    const R = L.ripple;
    let ring: THREE.Node<'float'> = float(0);
    for (let i = 0; i < R.max; i++) {
      const u = uniform(new THREE.Vector4(0, 0, -1e3, 0));
      this.ripples.push(u);
      const a = t.sub(u.z);
      const d = vec2(p.x, p.y).sub(u.xy).length();
      const f = d.sub(a.mul(R.speedMps)).div(R.widthM);
      ring = ring.add(exp(f.mul(f).negate()).mul(clamp(float(1).sub(a.div(R.lifeSec)), 0, 1)).mul(u.w));
    }

    const tint = color(L.tintColor).mul(float(L.baseHdr).add(pulse).add(ring).mul(fade));
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.colorNode = behind.add(tint);
    mat.fog = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, H), mat);
    this.mesh.position.set(0, H / 2, 0);
    // 不透明物の後に描く（向こう側の色を読むため）
    this.mesh.renderOrder = 1;
  }

  /** 球の通過（sim の cross イベント） */
  cross(x: number, y: number): void {
    this.addRipple(x, y, this.look.ripple.crossHdr);
  }

  /** 人がフェンスに触れている（描画側で毎フレーム判定。間隔を空けて波紋を出す） */
  touch(side: 0 | 1, x: number, y: number): void {
    if (this.nowSec - this.lastTouch[side]! < this.look.ripple.touchCooldownSec) return;
    this.lastTouch[side] = this.nowSec;
    this.addRipple(x, y, this.look.ripple.touchHdr);
  }

  update(nowSec: number, _dtSec: number): void {
    this.nowSec = nowSec;
    this.now.value = nowSec;
  }

  private addRipple(x: number, y: number, strength: number): void {
    const u = this.ripples[this.next]!;
    u.value.set(x, y, this.nowSec, strength);
    this.next = (this.next + 1) % this.ripples.length;
  }
}
