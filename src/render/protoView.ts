// 箱キャラ試作の描画（M1）。sim の状態を読むだけで書き換えない。
import * as THREE from 'three/webgpu';
import type { Balance } from '../sim/balance';
import type { Player, SimEvent, World } from '../sim/types';
import { clamp, color, dot, float, materialEmissive, normalView, positionViewDirection, uniform } from 'three/tsl';
import { PostPipeline, RENDER_LOOK, type PostDebugView } from './postPipeline';
import type { QualityPreset } from './quality';
import { Stage } from './stage';
import { CoreFace } from '../vfx/coreFace';
import { PlasmaFence } from '../vfx/plasmaFence';

export type FaceStage = 'smile' | 'nervous' | 'angry' | 'blink' | 'crack';

export function faceStage(b: Balance, countSec: number): FaceStage {
  const f = b.count.faceSec;
  if (countSec >= f.crack) return 'crack';
  if (countSec >= f.blink) return 'blink';
  if (countSec >= f.angry) return 'angry';
  if (countSec >= f.nervous) return 'nervous';
  return 'smile';
}


const PLAYER_COLOR = [0x35f2ff, 0xff2bd6] as const;
// FPS で手に持った球の表示位置（カメラ基準）と、投げた直後に実位置へ寄せる区間
const HELD_FORWARD_M = 0.75;
const HELD_RIGHT_M = 0.28;
const HELD_DOWN_M = 0.3;
const RELEASE_BLEND_U = 0.15;

interface Snap {
  px: [number, number];
  pz: [number, number];
  bx: number;
  by: number;
  bz: number;
  /** 飛翔の同一性（モード・投げ手・ラリー回数）。一致するときだけ外挿する */
  bMode: string;
  bThrower: number;
  bRally: number;
}

export class ProtoView {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  private players: THREE.Mesh[] = [];
  private playerMats: THREE.MeshStandardNodeMaterial[] = [];
  private playerRims: { value: number }[] = [];
  private playerBlobs: THREE.Mesh[] = [];
  private rimHdr = 0;
  private readonly stage: Stage;
  private ball: THREE.Mesh;
  private readonly face = new CoreFace();
  private readonly fence: PlasmaFence;
  private readonly fenceTouchZ: number;
  private lastTimeMs = -1;
  private ballShadow: THREE.Mesh;
  private prev: Snap = { px: [0, 0], pz: [0, 0], bx: 0, by: 0, bz: 0, bMode: '', bThrower: -1, bRally: 0 };
  private cur: Snap = { px: [0, 0], pz: [0, 0], bx: 0, by: 0, bz: 0, bMode: '', bThrower: -1, bRally: 0 };
  private readonly post: PostPipeline;
  backend = 'unknown';

  private constructor(renderer: THREE.WebGPURenderer, b: Balance, quality: QualityPreset, debugView: PostDebugView) {
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDER_LOOK.toneMappingExposure;
    this.post = new PostPipeline(renderer, this.scene, this.camera, debugView);
    this.post.configure(quality);
    this.stage = new Stage(this.scene, b, RENDER_LOOK.stage, PLAYER_COLOR);

    // プラズマ・フェンス（TSL。球の通過で波紋と閃光）
    this.fence = new PlasmaFence(b.court.widthM);
    this.scene.add(this.fence.mesh);
    this.fenceTouchZ = b.court.fenceClearanceM + b.player.bodyRadiusM + 0.05;

    const r = b.player.bodyRadiusM;
    const h = b.player.bodyHeightM;
    const rimLook = RENDER_LOOK.stage.opponentRim;
    for (const side of [0, 1] as const) {
      const mat = new THREE.MeshStandardNodeMaterial({ color: PLAYER_COLOR[side], emissive: PLAYER_COLOR[side], emissiveIntensity: 0.15, roughness: 0.5, transparent: true });
      // 相手にリムライト（背景から浮かせる。GDD 12.2 の可読性）。自分は 0
      const rim = uniform(0);
      const fres = float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)).pow(rimLook.power);
      mat.emissiveNode = materialEmissive.add(color(PLAYER_COLOR[side]).mul(fres).mul(rim));
      this.playerRims.push(rim);
      const m = new THREE.Mesh(new THREE.BoxGeometry(r * 2, h, r * 2), mat);
      m.position.y = h / 2;
      m.castShadow = true;
      // 向きを示す「顔」
      const nose = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      nose.position.set(0, h * 0.3, r + 0.05);
      m.add(nose);
      this.scene.add(m);
      this.players.push(m);
      this.playerMats.push(mat);
      // 影なし（低画質）のときの丸影
      const blob = new THREE.Mesh(new THREE.CircleGeometry(r * 1.4, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.005;
      this.scene.add(blob);
      this.playerBlobs.push(blob);
    }
    this.rimHdr = rimLook.hdr;

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(b.ball.radiusM, 48, 24), this.face.material);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ball.add(this.face.light);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(b.ball.radiusM * 1.2, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
  }

  /**
   * WebGPU で初期化し、初期化か試し描画（シェーダーのウォームアップを兼ねる）が失敗したら
   * WebGL2 バックエンドで作り直す（ADR 0001。古い Chrome では初回描画で例外が出る）
   */
  static async create(canvasHost: HTMLElement, b: Balance, quality: QualityPreset, debugView: PostDebugView = 'none'): Promise<ProtoView> {
    const attempt = async (forceWebGL: boolean): Promise<ProtoView> => {
      // AA はポスト（SMAA）で行う。RenderPipeline の最終出力にキャンバスの MSAA は要らない
      const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL });
      try {
        await renderer.init();
        renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatioMax));
        const v = new ProtoView(renderer, b, quality, debugView);
        v.stage.buildEnvironment(renderer, PLAYER_COLOR);
        v.setQuality(quality);
        v.post.render();
        v.backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
        return v;
      } catch (e) {
        renderer.dispose();
        throw e;
      }
    };
    let v: ProtoView;
    try {
      v = await attempt(false);
    } catch (e) {
      console.warn('WebGPU で描画できないため WebGL2 に切り替えます', e);
      v = await attempt(true);
    }
    canvasHost.appendChild(v.renderer.domElement);
    return v;
  }

  /** 画質段階のポスト構成（ブルーム・SMAA）を反映する */
  setQuality(preset: QualityPreset): void {
    this.post.configure(preset);
    this.stage.applyQuality(this.renderer, preset);
    for (const blob of this.playerBlobs) blob.visible = preset.shadowMapSize === 0;
  }

  /** 描画解像度の倍率（CSS px あたりの描画 px）。変えたら resize を呼ぶ */
  setPixelRatio(r: number): void {
    this.renderer.setPixelRatio(r);
  }

  /** 直前のフレームの描画情報（影・ポストの全画面パスを含む総数） */
  drawInfo(): { drawCalls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { drawCalls: r.drawCalls, triangles: r.triangles };
  }

  /** GPU の名前（取れない端末もある） */
  async gpuName(): Promise<string> {
    try {
      const be = this.renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: { adapterInfo?: GPUAdapterInfo }; gl?: WebGL2RenderingContext };
      if (be.isWebGPUBackend) {
        const info = be.device?.adapterInfo ?? (await navigator.gpu?.requestAdapter())?.info;
        return info ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || '非公開' : '不明';
      }
      const gl = be.gl;
      if (!gl) return '不明';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch (e) {
      return `取得できず: ${String(e)}`;
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** sim の tick ごとに呼ぶ（補間用のスナップショット） */
  snapshot(w: World): void {
    const p = this.prev;
    const c = this.cur;
    p.px[0] = c.px[0]; p.px[1] = c.px[1]; p.pz[0] = c.pz[0]; p.pz[1] = c.pz[1];
    p.bx = c.bx; p.by = c.by; p.bz = c.bz;
    p.bMode = c.bMode; p.bThrower = c.bThrower; p.bRally = c.bRally;
    for (const pl of w.players) {
      c.px[pl.side] = pl.pos.x;
      c.pz[pl.side] = pl.pos.z;
    }
    c.bx = w.ball.pos.x; c.by = w.ball.pos.y; c.bz = w.ball.pos.z;
    c.bMode = w.ball.mode; c.bThrower = w.ball.thrower; c.bRally = w.ball.rally;
  }

  /** sim のイベント（演出だけ。sim は書き換えない） */
  onSimEvent(e: SimEvent, w: World): void {
    if (e.kind === 'cross') this.fence.cross(w.ball.pos.x, w.ball.pos.y);
  }

  /** 補間済みの位置（カメラ追従用） */
  playerPos(side: 0 | 1, alpha: number): { x: number; z: number } {
    return {
      x: this.prev.px[side] + (this.cur.px[side] - this.prev.px[side]) * alpha,
      z: this.prev.pz[side] + (this.cur.pz[side] - this.prev.pz[side]) * alpha,
    };
  }

  private tint(p: Player, i: number, timeMs: number): void {
    const mat = this.playerMats[i]!;
    const base = PLAYER_COLOR[i]!;
    let emissive: number = base;
    let intensity = 0.15;
    switch (p.action) {
      case 'catch': emissive = 0xffffff; intensity = 0.9; break;
      case 'parry': emissive = 0xffe066; intensity = 0.9; break;
      case 'stagger': emissive = 0x555566; intensity = 0.05 + 0.1 * (Math.sin(timeMs / 40) > 0 ? 1 : 0); break;
      case 'hitReaction': emissive = 0xff2020; intensity = 1.2; break;
      case 'step': intensity = 0.8; break;
      case 'windup': case 'fakeWindup': intensity = 0.5; break;
    }
    mat.emissive.setHex(emissive);
    mat.emissiveIntensity = intensity;
  }

  /**
   * @param foeDisplay 通信対戦で相手を補間表示する位置（null なら sim の位置）。相手が持つ球もこれに合わせる
   */
  render(
    w: World, alpha: number, cam: { pos: { x: number; y: number; z: number }; fov: number; yaw: number; pitch: number; blend: number },
    me: 0 | 1, timeMs: number, foeDisplay: { x: number; z: number } | null = null,
  ): void {
    const b = w.balance;
    const dtSec = this.lastTimeMs < 0 ? 0 : Math.min(0.1, (timeMs - this.lastTimeMs) / 1000);
    this.lastTimeMs = timeMs;
    this.fence.update(timeMs / 1000, dtSec);
    for (const pl of w.players) {
      const m = this.players[pl.side]!;
      const pp = pl.side !== me && foeDisplay ? foeDisplay : this.playerPos(pl.side, alpha);
      m.position.x = pp.x;
      m.position.z = pp.z;
      this.playerBlobs[pl.side]!.position.set(pp.x, 0.005, pp.z);
      if (Math.abs(pp.z) <= this.fenceTouchZ) this.fence.touch(pl.side, pp.x, b.player.bodyHeightM * 0.6);
      this.playerRims[pl.side]!.value = pl.side === me ? 0 : this.rimHdr;
      // 自分は FPS のとき隠す。相手は常に自分の方を向く
      m.visible = !(pl.side === me && cam.blend > 0.5);
      // TPS の自分は半透明にして前が見えるようにする
      this.playerMats[pl.side]!.opacity = pl.side === me ? 0.35 : 1;
      if (pl.side === me) m.rotation.y = cam.yaw;
      else m.rotation.y = pl.side === 0 ? 0 : Math.PI;
      this.tint(pl, pl.side, timeMs);
    }
    const c = this.cur;
    const p = this.prev;
    // 飛翔中の球は補間ではなく外挿（cur + 速度·alpha）で描き、表示の遅れ（最大1tick）を消す。
    // キャッチ・跳ね返しを「気持ち早く押す」必要が出ないように、見えている球＝判定中の球に揃える。
    // 同じ飛翔が続いていないとき（投擲・返球の直後など）は外挿しない。
    const mode = w.ball.mode;
    const sameFlight = (mode === 'flight' || mode === 'linear') && p.bMode === c.bMode && p.bThrower === c.bThrower && p.bRally === c.bRally;
    const k = mode === 'held' ? 1 : sameFlight ? 1 + alpha : alpha;
    const bx = p.bx + (c.bx - p.bx) * k;
    const by = p.by + (c.by - p.by) * k;
    const bz = p.bz + (c.bz - p.bz) * k;
    const heldByMe = w.ball.mode === 'held' && w.ball.holder === me;
    // 所持中（FPS）は画面の右下に表示。投げた直後は右下から実際の位置へ寄せる（見た目だけ。判定は sim）
    const f = { x: Math.sin(cam.yaw) * Math.cos(cam.pitch), y: Math.sin(cam.pitch), z: Math.cos(cam.yaw) * Math.cos(cam.pitch) };
    const r = { x: -Math.cos(cam.yaw), z: Math.sin(cam.yaw) };
    const hx = cam.pos.x + f.x * HELD_FORWARD_M + r.x * HELD_RIGHT_M;
    const hy = cam.pos.y + f.y * HELD_FORWARD_M - HELD_DOWN_M;
    const hz = cam.pos.z + f.z * HELD_FORWARD_M + r.z * HELD_RIGHT_M;
    const justThrown = w.ball.mode === 'flight' && w.ball.thrower === me && w.ball.u < RELEASE_BLEND_U;
    const heldByFoe = w.ball.mode === 'held' && w.ball.holder !== me && w.ball.holder !== -1;
    if (heldByMe && cam.blend > 0.5) this.ball.position.set(hx, hy, hz);
    else if (heldByFoe && foeDisplay) {
      const fz = w.ball.holder === 0 ? 1 : -1;
      this.ball.position.set(foeDisplay.x, b.player.handHeightM, foeDisplay.z + fz * b.player.handForwardM);
    }
    else if (justThrown && cam.blend > 0.5) {
      const k = w.ball.u / RELEASE_BLEND_U;
      this.ball.position.set(hx + (bx - hx) * k, hy + (by - hy) * k, hz + (bz - hz) * k);
    } else this.ball.position.set(bx, by, bz);
    const stage = faceStage(b, w.ball.countTicks / b.tickHz);
    // 自分が FPS で持っている間は顔を暗くして視界を遮らない（相手や他の場面ではコアが一番明るい）
    this.face.update(stage, timeMs / 1000, heldByMe && cam.blend > 0.5);
    this.ball.scale.setScalar(stage === 'crack' ? 1 + 0.08 * Math.sin(timeMs / 30) : 1);
    this.ballShadow.visible = w.ball.mode !== 'held';
    this.ballShadow.position.set(this.ball.position.x, 0.006, this.ball.position.z);

    this.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(cam.pos.x + f.x, cam.pos.y + f.y, cam.pos.z + f.z);

    this.post.render();
  }
}
