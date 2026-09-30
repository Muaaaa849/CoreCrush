// 箱キャラ試作の描画（M1）。sim の状態を読むだけで書き換えない。
import * as THREE from 'three/webgpu';
import type { Balance } from '../sim/balance';
import type { Player, World } from '../sim/types';

export type FaceStage = 'smile' | 'nervous' | 'angry' | 'blink' | 'crack';

export function faceStage(b: Balance, countSec: number): FaceStage {
  const f = b.count.faceSec;
  if (countSec >= f.crack) return 'crack';
  if (countSec >= f.blink) return 'blink';
  if (countSec >= f.angry) return 'angry';
  if (countSec >= f.nervous) return 'nervous';
  return 'smile';
}

const FACE_COLOR: Record<FaceStage, number> = {
  smile: 0x35f2ff,
  nervous: 0xffd23f,
  angry: 0xff3b3b,
  blink: 0xff3b3b,
  crack: 0xffffff,
};

const PLAYER_COLOR = [0x35f2ff, 0xff2bd6];
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
  private playerMats: THREE.MeshStandardMaterial[] = [];
  private ball: THREE.Mesh;
  private ballMat: THREE.MeshStandardMaterial;
  private ballLight: THREE.PointLight;
  private ballShadow: THREE.Mesh;
  private prev: Snap = { px: [0, 0], pz: [0, 0], bx: 0, by: 0, bz: 0, bMode: '', bThrower: -1, bRally: 0 };
  private cur: Snap = { px: [0, 0], pz: [0, 0], bx: 0, by: 0, bz: 0, bMode: '', bThrower: -1, bRally: 0 };
  backend = 'unknown';

  private constructor(renderer: THREE.WebGPURenderer, b: Balance) {
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    this.scene.background = new THREE.Color(0x07080d);
    this.scene.add(new THREE.HemisphereLight(0x8899cc, 0x221122, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(-6, 14, 4);
    this.scene.add(sun);

    const W = b.court.widthM;
    const D = b.court.depthM;
    // 霧はコート全長（2D）より奥から効かせる（相手や奥の壁をかすませない）
    this.scene.fog = new THREE.Fog(0x07080d, D * 2, D * 5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D * 2), new THREE.MeshStandardMaterial({ color: 0x12141c, roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(D * 2, D * 2, 0x2a3350, 0x1a2032);
    grid.scale.set(W / (D * 2), 1, 1);
    grid.position.y = 0.002;
    this.scene.add(grid);

    // コートの縁（透明な壁の位置）
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, b.court.ceilingM, D * 2)),
      new THREE.LineBasicMaterial({ color: 0x3a4466 }),
    );
    edge.position.y = b.court.ceilingM / 2;
    this.scene.add(edge);

    // プラズマ・フェンス
    const fence = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 3),
      new THREE.MeshStandardMaterial({ color: 0x35f2ff, emissive: 0x35f2ff, emissiveIntensity: 0.25, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    );
    fence.position.set(0, 1.5, 0);
    this.scene.add(fence);

    // 自陣の色分け
    for (const side of [0, 1] as const) {
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(W, 0.08),
        new THREE.MeshBasicMaterial({ color: PLAYER_COLOR[side] }),
      );
      band.rotation.x = -Math.PI / 2;
      band.position.set(0, 0.004, side === 0 ? -D + 0.04 : D - 0.04);
      this.scene.add(band);
    }

    const r = b.player.bodyRadiusM;
    const h = b.player.bodyHeightM;
    for (const side of [0, 1] as const) {
      const mat = new THREE.MeshStandardMaterial({ color: PLAYER_COLOR[side], emissive: PLAYER_COLOR[side], emissiveIntensity: 0.15, roughness: 0.5, transparent: true });
      const m = new THREE.Mesh(new THREE.BoxGeometry(r * 2, h, r * 2), mat);
      m.position.y = h / 2;
      // 向きを示す「顔」
      const nose = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      nose.position.set(0, h * 0.3, r + 0.05);
      m.add(nose);
      this.scene.add(m);
      this.players.push(m);
      this.playerMats.push(mat);
    }

    this.ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: FACE_COLOR.smile, emissiveIntensity: 3 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(b.ball.radiusM, 32, 16), this.ballMat);
    this.scene.add(this.ball);
    this.ballLight = new THREE.PointLight(FACE_COLOR.smile, 8, 8);
    this.ball.add(this.ballLight);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(b.ball.radiusM * 1.2, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
  }

  /**
   * WebGPU で初期化し、初期化か試し描画（シェーダーのウォームアップを兼ねる）が失敗したら
   * WebGL2 バックエンドで作り直す（ADR 0001。古い Chrome では初回描画で例外が出る）
   */
  static async create(canvasHost: HTMLElement, b: Balance): Promise<ProtoView> {
    const attempt = async (forceWebGL: boolean): Promise<ProtoView> => {
      const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
      try {
        await renderer.init();
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        const v = new ProtoView(renderer, b);
        v.renderer.render(v.scene, v.camera);
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
    let emissive = base;
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

  render(w: World, alpha: number, cam: { pos: { x: number; y: number; z: number }; fov: number; yaw: number; pitch: number; blend: number }, me: 0 | 1, timeMs: number): void {
    const b = w.balance;
    for (const pl of w.players) {
      const m = this.players[pl.side]!;
      const pp = this.playerPos(pl.side, alpha);
      m.position.x = pp.x;
      m.position.z = pp.z;
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
    if (heldByMe && cam.blend > 0.5) this.ball.position.set(hx, hy, hz);
    else if (justThrown && cam.blend > 0.5) {
      const k = w.ball.u / RELEASE_BLEND_U;
      this.ball.position.set(hx + (bx - hx) * k, hy + (by - hy) * k, hz + (bz - hz) * k);
    } else this.ball.position.set(bx, by, bz);
    const stage = faceStage(b, w.ball.countTicks / b.tickHz);
    const blinkOff = (stage === 'blink' || stage === 'crack') && Math.sin(timeMs / 60) < 0;
    const col = FACE_COLOR[stage];
    this.ballMat.emissive.setHex(col);
    this.ballMat.emissiveIntensity = blinkOff ? 0.6 : 3;
    this.ballLight.color.setHex(col);
    this.ball.scale.setScalar(stage === 'crack' ? 1 + 0.08 * Math.sin(timeMs / 30) : 1);
    this.ballShadow.visible = w.ball.mode !== 'held';
    this.ballShadow.position.set(this.ball.position.x, 0.006, this.ball.position.z);

    this.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(cam.pos.x + f.x, cam.pos.y + f.y, cam.pos.z + f.z);

    this.renderer.render(this.scene, this.camera);
  }
}
