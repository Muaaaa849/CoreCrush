// タッチ操作の配置調整: 部品をドラッグで移動、選んだ部品の大きさをスライダー（または2本指のピンチ）で変える。
// 所持時・非所持時で出る部品が違うので、タブで切り替えて両方の配置を決める。
import type { TouchControls } from '../input/touchControls';
import {
  DEFAULT_TOUCH_LAYOUT,
  LOOK_MAX,
  LOOK_MIN,
  OPACITY_MIN,
  SIZE_MAX,
  SIZE_MIN,
  TOUCH_LABELS,
  clampPlacement,
  cloneLayout,
  type TouchControlId,
  type TouchLayout,
} from '../input/touchLayout';

interface Drag {
  id: TouchControlId;
  offX: number;
  offY: number;
}

export class TouchLayoutEditor {
  private readonly panel: HTMLDivElement;
  private tab: 'holding' | 'empty' = 'holding';
  private selected: TouchControlId = 'stick';
  private readonly drags = new Map<number, Drag>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { id: TouchControlId; a: number; b: number; dist: number; size: number } | null = null;
  private backup: TouchLayout | null = null;
  private panelDrag: { id: number; offX: number; offY: number } | null = null;
  private readonly q = <T extends HTMLElement>(sel: string) => this.panel.querySelector(sel) as T;

  constructor(
    private readonly tc: TouchControls,
    private readonly onClose: (layout: TouchLayout, saved: boolean) => void,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'tcPanel';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <div class="tcTabs" role="tablist">
        <button type="button" data-tab="holding">ボール所持時</button>
        <button type="button" data-tab="empty">非所持時</button>
      </div>
      <p class="tcHint">部品をドラッグで移動。タップで選んで大きさを変更（2本指でつまんでも可）。この枠も空いている所をドラッグで動かせます</p>
      <label>選択中 <span class="tcSel"></span></label>
      <label>大きさ <input type="range" class="tcSize" min="${SIZE_MIN}" max="${SIZE_MAX}" step="0.005"></label>
      <label>不透明度 <input type="range" class="tcOpacity" min="${OPACITY_MIN}" max="1" step="0.05"></label>
      <label>視点感度 <input type="range" class="tcLook" min="${LOOK_MIN}" max="${LOOK_MAX}" step="0.01"><output class="tcLookOut"></output></label>
      <label class="tcCheck"><input type="checkbox" class="tcFloat"> スティックを触った場所に出す（左側）</label>
      <div class="tcActions">
        <button type="button" class="ghost tcReset">既定に戻す</button>
        <button type="button" class="ghost tcCancel">取り消し</button>
        <button type="button" class="tcDone">保存</button>
      </div>`;
    tc.root.append(this.panel);

    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab === 'empty' ? 'empty' : 'holding';
        if (!this.visibleInTab(this.selected)) this.selected = 'stick';
        this.sync();
      });
    }
    this.q<HTMLInputElement>('.tcSize').addEventListener('input', (e) => {
      const p = this.tc.layout.controls[this.selected];
      this.tc.layout.controls[this.selected] = clampPlacement({ ...p, size: Number((e.target as HTMLInputElement).value) });
      this.tc.applyLayout();
    });
    this.q<HTMLInputElement>('.tcOpacity').addEventListener('input', (e) => {
      this.tc.layout.opacity = Number((e.target as HTMLInputElement).value);
      this.tc.applyLayout();
    });
    this.q<HTMLInputElement>('.tcLook').addEventListener('input', (e) => {
      this.tc.layout.lookDegPerPx = Number((e.target as HTMLInputElement).value);
      this.sync();
    });
    this.q<HTMLInputElement>('.tcFloat').addEventListener('change', (e) => {
      this.tc.layout.stickFloating = (e.target as HTMLInputElement).checked;
    });
    this.q('.tcReset').addEventListener('click', () => {
      this.tc.layout = cloneLayout(DEFAULT_TOUCH_LAYOUT);
      this.tc.applyLayout();
      this.sync();
    });
    this.q('.tcCancel').addEventListener('click', () => this.close(false));
    this.q('.tcDone').addEventListener('click', () => this.close(true));

    const root = tc.root;
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    this.backup = cloneLayout(this.tc.layout);
    this.tc.releaseAll();
    this.tc.editing = true;
    this.tc.root.hidden = false;
    this.tc.root.classList.add('editing');
    this.panel.hidden = false;
    this.tc.applyLayout();
    this.sync();
  }

  private close(save: boolean): void {
    if (!save && this.backup) {
      this.tc.layout = this.backup;
      this.tc.applyLayout();
    }
    this.backup = null;
    this.drags.clear();
    this.pinch = null;
    this.tc.editing = false;
    this.tc.root.classList.remove('editing');
    this.panel.hidden = true;
    this.tc.refresh();
    this.onClose(this.tc.layout, save);
  }

  private visibleInTab(id: TouchControlId): boolean {
    this.tc.refresh(this.tab);
    return !this.tc.els[id].hidden;
  }

  private sync(): void {
    this.tc.refresh(this.tab);
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    for (const [id, el] of Object.entries(this.tc.els)) el.classList.toggle('selected', id === this.selected);
    const l = this.tc.layout;
    this.q('.tcSel').textContent = TOUCH_LABELS[this.selected];
    this.q<HTMLInputElement>('.tcSize').value = String(l.controls[this.selected].size);
    this.q<HTMLInputElement>('.tcOpacity').value = String(l.opacity);
    this.q<HTMLInputElement>('.tcLook').value = String(l.lookDegPerPx);
    this.q('.tcLookOut').textContent = l.lookDegPerPx.toFixed(2);
    this.q<HTMLInputElement>('.tcFloat').checked = l.stickFloating;
  }

  private down(e: PointerEvent): void {
    if (!this.isOpen) return;
    if (this.panel.contains(e.target as Node)) {
      // 枠の空いている所をつかむと枠ごと動かす（下に隠れた部品を触れるように）
      if ((e.target as HTMLElement).closest('input, button, output')) return;
      e.preventDefault();
      const r = this.panel.getBoundingClientRect();
      this.panelDrag = { id: e.pointerId, offX: e.clientX - r.left, offY: e.clientY - r.top };
      try {
        this.tc.root.setPointerCapture(e.pointerId);
      } catch {
        /* root 上なら届く */
      }
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ctl]');
    const id = el?.dataset.ctl as TouchControlId | undefined;
    if (!id) return;
    e.preventDefault();
    try {
      this.tc.root.setPointerCapture(e.pointerId);
    } catch {
      /* root 上なら届く */
    }
    const first = [...this.drags].find(([, d]) => d.id === id);
    const a = first && this.pointers.get(first[0]);
    if (first && a) {
      // 同じ部品に2本目の指 → ピンチで大きさ
      this.pinch = { id, a: first[0], b: e.pointerId, dist: Math.max(1, Math.hypot(e.clientX - a.x, e.clientY - a.y)), size: this.tc.layout.controls[id].size };
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    const p = this.tc.layout.controls[id];
    const w = this.tc.root.clientWidth;
    const h = this.tc.root.clientHeight;
    this.drags.set(e.pointerId, { id, offX: e.clientX - p.x * w, offY: e.clientY - p.y * h });
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.selected = id;
    this.sync();
  }


  private move(e: PointerEvent): void {
    if (!this.isOpen) return;
    if (this.panelDrag?.id === e.pointerId) {
      e.preventDefault();
      const w = this.tc.root.clientWidth;
      const h = this.tc.root.clientHeight;
      const r = this.panel.getBoundingClientRect();
      const x = Math.max(0, Math.min(w - r.width, e.clientX - this.panelDrag.offX));
      const y = Math.max(0, Math.min(h - r.height, e.clientY - this.panelDrag.offY));
      this.panel.style.transform = 'none';
      this.panel.style.left = `${x}px`;
      this.panel.style.top = `${y}px`;
      return;
    }
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && (e.pointerId === this.pinch.a || e.pointerId === this.pinch.b)) {
      const a = this.pointers.get(this.pinch.a);
      const b = this.pointers.get(this.pinch.b);
      if (a && b) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const p = this.tc.layout.controls[this.pinch.id];
        this.tc.layout.controls[this.pinch.id] = clampPlacement({ ...p, size: (this.pinch.size * d) / this.pinch.dist });
        this.tc.applyLayout();
        this.sync();
      }
      return;
    }
    const drag = this.drags.get(e.pointerId);
    if (!drag) return;
    const w = this.tc.root.clientWidth;
    const h = this.tc.root.clientHeight;
    const p = this.tc.layout.controls[drag.id];
    this.tc.layout.controls[drag.id] = clampPlacement({ ...p, x: (e.clientX - drag.offX) / w, y: (e.clientY - drag.offY) / h });
    this.tc.applyLayout();
  }

  private up(e: PointerEvent): void {
    if (this.panelDrag?.id === e.pointerId) this.panelDrag = null;
    this.drags.delete(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pinch && (e.pointerId === this.pinch.a || e.pointerId === this.pinch.b)) this.pinch = null;
    // ピンチの後に残った指で急に動かないよう、ドラッグの基準を取り直す
    for (const [pid, d] of this.drags) {
      const pt = this.pointers.get(pid);
      if (!pt) continue;
      const p = this.tc.layout.controls[d.id];
      d.offX = pt.x - p.x * this.tc.root.clientWidth;
      d.offY = pt.y - p.y * this.tc.root.clientHeight;
    }
  }
}
