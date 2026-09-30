// キーボード・マウス入力（KeyboardEvent.code＝物理位置で扱う。GDD 14.1）
// 押した瞬間（エッジ）は sim の次の tick で1回だけ消費する。
export interface Bindings {
  forward: string;
  back: string;
  left: string;
  right: string;
  step: string;
  fake: string;
}

export const DEFAULT_BINDINGS: Bindings = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  step: 'ShiftLeft',
  fake: 'KeyQ',
};

export class KeyboardMouse {
  readonly down = new Set<string>();
  primaryHeld = false;
  secondaryHeld = false;
  private edges = { primary: false, secondary: false, fake: false, step: false };
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  unadjusted: 'yes' | 'no' | 'unknown' = 'unknown';
  onKey?: (code: string) => void;

  constructor(
    private readonly target: HTMLElement,
    public bindings: Bindings = DEFAULT_BINDINGS,
  ) {
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code === this.bindings.fake) this.edges.fake = true;
      if (e.code === this.bindings.step) this.edges.step = true;
      this.onKey?.(e.code);
      if (this.locked && e.code !== 'Escape') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.primaryHeld = true;
        this.edges.primary = true;
      } else if (e.button === 2) {
        this.secondaryHeld = true;
        this.edges.secondary = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.primaryHeld = false;
      if (e.button === 2) this.secondaryHeld = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) {
        this.down.clear();
        this.primaryHeld = this.secondaryHeld = false;
      }
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  async lock(): Promise<void> {
    type Req = (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    try {
      await (this.target.requestPointerLock as Req)({ unadjustedMovement: true });
      this.unadjusted = 'yes';
    } catch {
      this.unadjusted = 'no';
      await (this.target.requestPointerLock as Req)();
    }
  }

  axis(neg: string, pos: string): number {
    return (this.down.has(pos) ? 1 : 0) - (this.down.has(neg) ? 1 : 0);
  }

  /** 前回の消費以降に押されたか（1回だけ true） */
  takeEdges(): { primary: boolean; secondary: boolean; fake: boolean; step: boolean } {
    const e = { ...this.edges };
    this.edges.primary = this.edges.secondary = this.edges.fake = this.edges.step = false;
    return e;
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
}
