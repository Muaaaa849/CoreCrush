// プラズマ・フェンス（GDD 1・13 章）。コート中央の平面を TSL で: スクロールするノイズの放電筋、フレネル、ヒット波紋（最大 4 つを uniform で）。
// 球の通過で閃光と大きな波紋、人が触れると小さな波紋。常時の発光はブルームのしきい値未満（相手が透けて見えるように）。
// 数値は data/vfx/plasmaFence.json。試合中に new しない（波紋は固定長の uniform を使い回す）。
import * as THREE from 'three/webgpu';
import {
  abs, clamp, color, dot, exp, float, mix, mx_fractal_noise_float, normalView, positionViewDirection, positionWorld, smoothstep, uniform, vec2, vec3,
} from 'three/tsl';
import fenceJson from '../../data/vfx/plasmaFence.json';

export interface PlasmaFenceLook {
  heightM: number;
  colorA: string;
  colorB: string;
  baseHdr: number;
  streakHdr: number;
  fresnelHdr: number;
  noiseScale: [number, number];
  scrollMps: number;
  topFadeM: number;
  ripple: { max: number; speedMps: number; widthM: number; lifeSec: number; crossHdr: number; touchHdr: number; touchCooldownSec: number };
  flash: { hdr: number; decaySec: number };
}

export const PLASMA_FENCE: PlasmaFenceLook = fenceJson as PlasmaFenceLook;

export class PlasmaFence {
  readonly mesh: THREE.Mesh;
  private readonly now = uniform(0);
  private readonly flash = uniform(0);
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
    // 放電の筋: ノイズの 0 付近を細い線として取り出す
    const n = mx_fractal_noise_float(vec3(p.x.mul(L.noiseScale[0]), p.y.mul(L.noiseScale[1]).sub(t.mul(L.scrollMps)), t.mul(0.3)), 3, 2, 0.5);
    const streak = float(1).sub(clamp(abs(n).mul(9), 0, 1)).pow(4);
    const hue = smoothstep(-0.4, 0.4, mx_fractal_noise_float(vec3(p.x.mul(0.08), p.y.mul(0.08), t.mul(0.1)), 1, 2, 0.5));
    const tint = mix(color(L.colorA), color(L.colorB), hue.mul(0.5));
    // 斜めから見るほど濃く見える（フレネル）
    const fres = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2);
    // 波紋
    const R = L.ripple;
    let ring: THREE.Node<'float'> = float(0);
    for (let i = 0; i < R.max; i++) {
      const u = uniform(new THREE.Vector4(0, 0, -1e3, 0));
      this.ripples.push(u);
      const age = t.sub(u.z);
      const d = vec2(p.x, p.y).sub(u.xy).length();
      const front = d.sub(age.mul(R.speedMps)).div(R.widthM);
      const life = clamp(float(1).sub(age.div(R.lifeSec)), 0, 1);
      const core = exp(d.mul(d).mul(-4)).mul(life.pow(3));
      ring = ring.add(exp(front.mul(front).negate()).mul(life).add(core).mul(u.w));
    }
    const fade = float(1).sub(smoothstep(H - L.topFadeM, H, p.y)).mul(smoothstep(0, 0.15, p.y));
    const glow = float(L.baseHdr).add(streak.mul(L.streakHdr)).add(fres.mul(L.fresnelHdr)).add(this.flash.mul(L.flash.hdr)).mul(fade);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    mat.colorNode = tint.mul(glow).add(mix(vec3(1, 1, 1), tint, 0.35).mul(ring));
    mat.fog = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, H), mat);
    this.mesh.position.set(0, H / 2, 0);
    // 不透明物の後に描く（相手の体の手前に重なる）
    this.mesh.renderOrder = 1;
  }

  /** 球の通過（sim の cross イベント） */
  cross(x: number, y: number): void {
    this.addRipple(x, y, this.look.ripple.crossHdr);
    this.flash.value = 1;
  }

  /** 人がフェンスに触れている（描画側で毎フレーム判定。間隔を空けて波紋を出す） */
  touch(side: 0 | 1, x: number, y: number): void {
    if (this.nowSec - this.lastTouch[side]! < this.look.ripple.touchCooldownSec) return;
    this.lastTouch[side] = this.nowSec;
    this.addRipple(x, y, this.look.ripple.touchHdr);
  }

  update(nowSec: number, dtSec: number): void {
    this.nowSec = nowSec;
    this.now.value = nowSec;
    this.flash.value = Math.max(0, this.flash.value - dtSec / this.look.flash.decaySec);
  }

  private addRipple(x: number, y: number, strength: number): void {
    const u = this.ripples[this.next]!;
    u.value.set(x, y, this.nowSec, strength);
    this.next = (this.next + 1) % this.ripples.length;
  }
}
