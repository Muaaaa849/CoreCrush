// 空気中の塵（うっすらパーティクル。docs/research/graphics-compositing.md「空気中の塵」）。
// 起動時に位置を 1 回だけ作り、漂いはシェーダーで（毎フレームの CPU 処理・アロケーションなし）。
// 光らせない（HDR 輝度はブルームのしきい値未満）。数は画質の particleMul を掛ける。
import * as THREE from 'three/webgpu';
import { color, float, fract, instancedBufferAttribute, sin, smoothstep, time, uv, vec3, length } from 'three/tsl';
import type { DustLook } from './postPipeline';

export class Dust {
  readonly sprite: THREE.Sprite;
  private readonly max: number;

  constructor(look: DustLook) {
    this.max = look.count;
    const [ax, ay, az] = look.areaM;
    const base = new Float32Array(look.count * 4);
    let s = 0x5eed;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < look.count; i++) {
      base[i * 4] = (rnd() - 0.5) * ax;
      base[i * 4 + 1] = rnd();
      base[i * 4 + 2] = (rnd() - 0.5) * az;
      base[i * 4 + 3] = rnd() * 100;
    }
    const attr = new THREE.InstancedBufferAttribute(base, 4);
    const b = instancedBufferAttribute(attr) as unknown as THREE.Node<'vec4'>;
    const phase = b.w;
    // ゆっくり上昇してループ（高さ 0〜ay）、横に小さく揺れる
    const y = fract(b.y.add(time.mul(look.driftMps / ay))).mul(ay);
    const sway = look.driftMps * 4;
    const pos = vec3(b.x.add(sin(time.mul(0.3).add(phase)).mul(sway)), y, b.z.add(sin(time.mul(0.23).add(phase.mul(1.7))).mul(sway)));
    const mat = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false });
    mat.positionNode = pos;
    mat.sizeNode = float(look.sizePx);
    // 丸い点、上下の端で消える、ゆっくり瞬く
    const d = length(uv().sub(0.5)).mul(2);
    const fadeY = smoothstep(0, 0.15, y.div(ay)).mul(smoothstep(1, 0.7, y.div(ay)));
    const twinkle = sin(time.mul(0.9).add(phase.mul(3))).mul(0.35).add(0.65);
    mat.colorNode = color(look.color).mul(look.hdr);
    mat.opacityNode = float(1).sub(smoothstep(0.4, 1, d)).mul(fadeY).mul(twinkle);
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = look.count;
    this.sprite.frustumCulled = false;
  }

  applyQuality(particleMul: number): void {
    this.sprite.count = Math.round(this.max * particleMul);
    this.sprite.visible = this.sprite.count > 0;
  }
}
