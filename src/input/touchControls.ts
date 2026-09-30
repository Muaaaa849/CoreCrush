// スマホ（横持ち）のタッチ操作: 左に仮想スティック、右にボタン、それ以外の場所のドラッグで視点。
// ボタンの「押した瞬間」は KeyboardMouse と同じく sim の次の tick で1回だけ消費する。
// スティックの向きは移動と球種の両方に使う（キーボードの WASD と同じ。球種は sim の throwTypeFromInput が決める）。
import type { ThrowTypeName } from '../sim/balance';
import {
  EMPTY_CONTROLS,
  HOLDING_CONTROLS,
  TOUCH_CONTROL_IDS,
  TOUCH_LABELS,
  stickVector,
  type TouchControlId,
  type TouchLayout,
} from './touchLayout';

export type SkillSlot = 'skill1' | 'skill2' | 'summon';
export const SKILL_SLOTS: readonly SkillSlot[] = ['skill1', 'skill2', 'summon'];

export interface TouchEdges {
  primary: boolean;
  secondary: boolean;
  fake: boolean;
  step: boolean;
  skill1: boolean;
  skill2: boolean;
  summon: boolean;
}

/** スティックの無反応域（半径に対する割合） */
const STICK_DEADZONE = 0.15;
/** 固定スティックで、土台の外側どこまでの接触をスティックとして拾うか（半径に対する倍率） */
const STICK_GRAB = 1.5;
/** スティック追従モードで、画面の左からどこまでをスティックの領域にするか */
const FLOAT_ZONE = 0.45;
/** ボタンを押したまま指を動かしたとき、視点操作に切り替える移動量（px） */
const BUTTON_DRAG_PX = 10;

export const THROW_LABELS: Record<ThrowTypeName, string> = {
  straight: 'ストレート',
  curveLeft: '左カーブ',
  curveRight: '右カーブ',
  lob: '上カーブ',
  aimed: '狙い投げ',
};

type Role =
  | { kind: 'stick'; cx: number; cy: number }
  | { kind: 'look'; x: number; y: number }
  | { kind: 'button'; id: TouchControlId; x0: number; y0: number; x: number; y: number; dragging: boolean };

export class TouchControls {
  readonly root: HTMLDivElement;
  readonly els = {} as Record<TouchControlId, HTMLDivElement>;
  private readonly knob: HTMLDivElement;
  private readonly dirs: Record<'straight' | 'curveLeft' | 'curveRight' | 'lob', HTMLSpanElement>;
  private readonly roles = new Map<number, Role>();
  private edges: TouchEdges = { primary: false, secondary: false, fake: false, step: false, skill1: false, skill2: false, summon: false };
  private lookDX = 0;
  private lookDY = 0;
  private holding = false;
  private throwType: ThrowTypeName | null = null;
  /** 装備スキルの表示名。未設定のスロットはボタンを出さない */
  private skills: Partial<Record<SkillSlot, string>> = {};

  /** true の間だけ入力を受ける（試合中） */
  active = false;
  /** 配置の調整中は入力を受けず、調整画面に任せる */
  editing = false;
  /** 右 = +1、前 = +1 */
  stickX = 0;
  stickY = 0;
  /** 所持中の「狙い」は押すたびに ON/OFF（右クリック押しっぱなしの代わり） */
  aimOn = false;
  catchHeld = false;
  onPause?: () => void;

  constructor(
    host: HTMLElement,
    public layout: TouchLayout,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'tc';
    this.root.hidden = true;
    for (const id of TOUCH_CONTROL_IDS) {
      const el = document.createElement('div');
      el.className = `tcCtl tc-${id}`;
      el.dataset.ctl = id;
      if (id !== 'stick') {
        el.classList.add('tcBtn');
        const main = document.createElement('b');
        main.textContent = id === 'pause' ? 'Ⅱ' : TOUCH_LABELS[id];
        const sub = document.createElement('small');
        el.append(main, sub);
      }
      this.els[id] = el;
      this.root.append(el);
    }
    const stick = this.els.stick;
    this.knob = document.createElement('div');
    this.knob.className = 'tcKnob';
    const dir = (cls: string, text: string) => {
      const s = document.createElement('span');
      s.className = `tcDir ${cls}`;
      s.textContent = text;
      stick.append(s);
      return s;
    };
    // 球種の目安（所持中だけ出す）。前・無入力＝ストレート、左右＝カーブ、後ろ＝上カーブ
    this.dirs = {
      straight: dir('up', THROW_LABELS.straight),
      curveLeft: dir('left', THROW_LABELS.curveLeft),
      curveRight: dir('right', THROW_LABELS.curveRight),
      lob: dir('down', THROW_LABELS.lob),
    };
    stick.append(this.knob);
    host.append(this.root);

    this.root.addEventListener('pointerdown', (e) => this.down(e));
    this.root.addEventListener('pointermove', (e) => this.move(e));
    this.root.addEventListener('pointerup', (e) => this.up(e));
    this.root.addEventListener('pointercancel', (e) => this.up(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.applyLayout());
    window.addEventListener('blur', () => this.releaseAll());
    this.applyLayout();
    this.refresh();
  }

  /** 部品の位置・大きさを layout から置き直す */
  applyLayout(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const s = Math.min(w, h);
    this.root.style.setProperty('--tc-opacity', String(this.layout.opacity));
    for (const id of TOUCH_CONTROL_IDS) {
      const p = this.layout.controls[id];
      const d = p.size * s;
      const el = this.els[id];
      el.style.width = el.style.height = `${d}px`;
      el.style.left = `${p.x * w - d / 2}px`;
      el.style.top = `${p.y * h - d / 2}px`;
      el.style.fontSize = `${Math.max(9, d * (id === 'stick' ? 0.075 : 0.17))}px`;
    }
    this.resetStickVisual();
  }

  /** 装備スキルを設定する（キーはスロット、値はボタンの表示名）。空ならスキルボタンは出ない */
  setSkills(skills: Partial<Record<SkillSlot, string>>): void {
    this.skills = { ...skills };
    for (const slot of SKILL_SLOTS) {
      const b = this.els[slot].querySelector('b');
      if (b) b.textContent = this.skills[slot] ?? TOUCH_LABELS[slot];
    }
    this.refresh();
  }

  hasSkill(slot: SkillSlot): boolean {
    return this.skills[slot] !== undefined;
  }

  /** 毎フレーム呼ぶ: ボールの所持と、今の入力で投げたときの球種（非所持なら null） */
  setState(holding: boolean, throwType: ThrowTypeName | null): void {
    if (!holding) this.aimOn = false;
    if (holding === this.holding && throwType === this.throwType) return;
    this.holding = holding;
    this.throwType = throwType;
    this.refresh();
  }

  /** 表示する部品の組と、ラベル・強調の更新 */
  refresh(editTab?: 'holding' | 'empty'): void {
    const holding = editTab ? editTab === 'holding' : this.holding;
    const set = holding ? HOLDING_CONTROLS : EMPTY_CONTROLS;
    for (const id of TOUCH_CONTROL_IDS) {
      const isSkill = (SKILL_SLOTS as readonly string[]).includes(id);
      // 調整中は未装備のスキル枠も出す（先に置き場所を決められるように）
      const show = set.includes(id) && (!isSkill || editTab !== undefined || this.hasSkill(id as SkillSlot));
      this.els[id].hidden = !show;
      this.els[id].classList.toggle('empty', isSkill && !this.hasSkill(id as SkillSlot));
    }
    this.root.classList.toggle('holding', holding);
    this.els.aim.classList.toggle('on', this.aimOn);
    const sub = this.els.throw.querySelector('small');
    if (sub) sub.textContent = holding && this.throwType ? THROW_LABELS[this.throwType] : '';
    for (const [k, el] of Object.entries(this.dirs)) el.classList.toggle('on', k === this.throwType);
  }

  takeEdges(): TouchEdges {
    const e = { ...this.edges };
    for (const k of Object.keys(this.edges) as (keyof TouchEdges)[]) this.edges[k] = false;
    return e;
  }

  /** 前回の消費以降の視点ドラッグ量（CSS px。右・下が +） */
  takeLook(): [number, number] {
    const d: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return d;
  }

  /** 所持中は「狙い」の ON/OFF、非所持中はキャッチボタンの押下（キーボードの右ボタン押しっぱなしに相当） */
  get secondaryHeld(): boolean {
    return this.holding ? this.aimOn : this.catchHeld;
  }

  releaseAll(): void {
    this.roles.clear();
    this.stickX = this.stickY = 0;
    this.catchHeld = false;
    this.lookDX = this.lookDY = 0;
    for (const id of TOUCH_CONTROL_IDS) this.els[id].classList.remove('pressed');
    this.resetStickVisual();
  }

  private center(id: TouchControlId): [number, number] {
    const p = this.layout.controls[id];
    return [p.x * this.root.clientWidth, p.y * this.root.clientHeight];
  }

  private stickRadius(): number {
    return (this.layout.controls.stick.size * Math.min(this.root.clientWidth, this.root.clientHeight)) / 2;
  }

  private resetStickVisual(): void {
    this.knob.style.transform = 'translate(-50%, -50%)';
    const el = this.els.stick;
    el.classList.remove('pressed');
    if (this.layout.stickFloating) {
      const p = this.layout.controls.stick;
      const d = p.size * Math.min(this.root.clientWidth || window.innerWidth, this.root.clientHeight || window.innerHeight);
      el.style.left = `${p.x * (this.root.clientWidth || window.innerWidth) - d / 2}px`;
      el.style.top = `${p.y * (this.root.clientHeight || window.innerHeight) - d / 2}px`;
    }
  }

  private down(e: PointerEvent): void {
    if (!this.active || this.editing) return;
    // 部品でない普通のボタン（試合終了時の「もう一度」など）はクリックとして通す
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-ctl]');
    const id = target?.dataset.ctl as TouchControlId | undefined;
    const x = e.clientX;
    const y = e.clientY;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* 取れなくても root 上なら届く */
    }
    if (id && id !== 'stick' && !this.els[id].hidden) {
      this.press(id);
      this.roles.set(e.pointerId, { kind: 'button', id, x0: x, y0: y, x, y, dragging: false });
      return;
    }
    if (!this.hasStickPointer()) {
      const w = this.root.clientWidth;
      const r = this.stickRadius();
      if (this.layout.stickFloating && x < w * FLOAT_ZONE) {
        // 触った場所を中心にする
        const el = this.els.stick;
        el.style.left = `${x - r}px`;
        el.style.top = `${y - r}px`;
        this.roles.set(e.pointerId, { kind: 'stick', cx: x, cy: y });
        el.classList.add('pressed');
        return;
      }
      const [cx, cy] = this.center('stick');
      if (id === 'stick' || Math.hypot(x - cx, y - cy) <= r * STICK_GRAB) {
        this.roles.set(e.pointerId, { kind: 'stick', cx, cy });
        this.els.stick.classList.add('pressed');
        this.stickTo(x - cx, y - cy);
        return;
      }
    }
    this.roles.set(e.pointerId, { kind: 'look', x, y });
  }

  private move(e: PointerEvent): void {
    const r = this.roles.get(e.pointerId);
    if (!r) return;
    e.preventDefault();
    if (r.kind === 'stick') {
      this.stickTo(e.clientX - r.cx, e.clientY - r.cy);
    } else if (r.kind === 'look') {
      this.lookDX += e.clientX - r.x;
      this.lookDY += e.clientY - r.y;
      r.x = e.clientX;
      r.y = e.clientY;
    } else {
      // ボタンを押したまま指を滑らせると視点が動く（押してから狙いを微調整できる）
      if (!r.dragging && Math.hypot(e.clientX - r.x0, e.clientY - r.y0) >= BUTTON_DRAG_PX) {
        r.dragging = true;
        r.x = e.clientX;
        r.y = e.clientY;
      }
      if (r.dragging) {
        this.lookDX += e.clientX - r.x;
        this.lookDY += e.clientY - r.y;
        r.x = e.clientX;
        r.y = e.clientY;
      }
    }
  }

  private up(e: PointerEvent): void {
    const r = this.roles.get(e.pointerId);
    if (!r) return;
    this.roles.delete(e.pointerId);
    if (r.kind === 'stick') {
      this.stickX = this.stickY = 0;
      this.resetStickVisual();
    } else if (r.kind === 'button') {
      this.els[r.id].classList.remove('pressed');
      if (r.id === 'catch') this.catchHeld = false;
    }
  }

  private hasStickPointer(): boolean {
    for (const r of this.roles.values()) if (r.kind === 'stick') return true;
    return false;
  }

  private stickTo(dx: number, dy: number): void {
    const r = this.stickRadius();
    const v = stickVector(dx, dy, r, STICK_DEADZONE, { x: 0, y: 0 });
    this.stickX = v.x;
    this.stickY = v.y;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
  }

  private press(id: TouchControlId): void {
    this.els[id].classList.add('pressed');
    switch (id) {
      case 'throw':
      case 'parry':
        this.edges.primary = true;
        break;
      case 'catch':
        this.edges.secondary = true;
        this.catchHeld = true;
        break;
      case 'aim':
        this.aimOn = !this.aimOn;
        this.els.aim.classList.toggle('on', this.aimOn);
        break;
      case 'fake':
        this.edges.fake = true;
        break;
      case 'step':
        this.edges.step = true;
        break;
      case 'skill1':
      case 'skill2':
      case 'summon':
        this.edges[id] = true;
        break;
      case 'pause':
        this.releaseAll();
        this.onPause?.();
        break;
      default:
        break;
    }
  }
}
