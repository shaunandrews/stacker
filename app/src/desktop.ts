import { PerspectiveCamera, Vector2, Vector3 } from '@iwsdk/core';

// Mouse-and-keyboard input for playing on a computer, outside XR. The system reads it
// once a frame as a virtual right hand (a ray from the camera through the cursor) and
// drives an orbit camera around the platform. Trackpad-friendly, Figma-style:
//
//   two-finger scroll    pan                 pinch (or wheel on a mouse)   zoom
//   ⌥ + two-finger / ⌥-drag / right-drag     orbit    ⇧ + right-drag / middle-drag: pan
//   W A S D              pan across the table (nothing held)   Q / E: orbit (nothing held)
//   PgUp / PgDn          tilt                + / −  zoom        F: frame the plate
//   double-click         focus a block       Esc / right-click: put the brush down
//   left-click / drag    place with the brush, or grab and move a block
//   ⇧-click / ⇧-drag     select / box-select          ⌥-click or I: eyedropper
//   R (⇧R) · T (⇧T)      spin · tip the brush or held block (Q/E, arrows too)
//   ⌘C ⌘V ⌘D ⌘A          copy · paste · duplicate · select all
//   Delete / Backspace   delete       1–9: hotbar      Space: place / take the photo
//   ⌘/Ctrl + Z           undo (Shift: redo)

export type DesktopAction =
  | 'spinL'
  | 'spinR'
  | 'tipU'
  | 'tipD'
  | 'delete'
  | 'undo'
  | 'redo'
  | 'frame'
  | 'shoot'
  | 'cancel'
  | 'focus'
  | 'pick'
  | 'copy'
  | 'paste'
  | 'dup'
  | 'selectAll'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'slot5'
  | 'slot6'
  | 'slot7'
  | 'slot8'
  | 'slot9';

const KEYS: Record<string, DesktopAction> = {
  q: 'spinL',
  arrowleft: 'spinL',
  e: 'spinR',
  arrowright: 'spinR',
  arrowup: 'tipU',
  arrowdown: 'tipD',
  delete: 'delete',
  backspace: 'delete',
  f: 'frame',
  ' ': 'shoot',
  escape: 'cancel',
  i: 'pick',
  '1': 'slot1',
  '2': 'slot2',
  '3': 'slot3',
  '4': 'slot4',
  '5': 'slot5',
  '6': 'slot6',
  '7': 'slot7',
  '8': 'slot8',
  '9': 'slot9',
};
const META: Record<string, DesktopAction> = { c: 'copy', v: 'paste', d: 'dup', a: 'selectAll' };
/** Keys that move the camera while held (only when nothing is held: see `busy`). */
const HELD = new Set(['w', 'a', 's', 'd', 'q', 'e', 'pageup', 'pagedown', '=', '+', '-', '_']);

export type WheelMode = 'auto' | 'trackpad' | 'mouse';

export class DesktopControls {
  enabled = false;
  /** Cursor in normalized device coordinates. */
  readonly ndc = new Vector2();
  /** Where the left button went down (a fast drag can leave the target before the next frame). */
  readonly pressNdc = new Vector2();
  /** Left button went down / up this frame; `alt` and `shift` as held at press time. */
  pressed = false;
  released = false;
  alt = false;
  shift = false;
  actions = new Set<DesktopAction>();
  /** The system sets this while something is held, so W A S D / Q / E don't move the camera. */
  busy = false;
  /** How plain wheel events are read: `auto` tells a trackpad (pan) from a mouse wheel (zoom). */
  wheelMode: WheelMode = 'auto';
  /** The HUD covers this pointer position: ignore presses there. */
  overHud: (x: number, y: number) => boolean = () => false;

  // Orbit camera
  readonly target = new Vector3();
  azimuth = 0;
  elevation = 0.55;
  distance = 0.8;

  private drag: { mode: 'orbit' | 'pan'; x: number; y: number; moved: number; button: number } | null = null;
  private altPress: { x: number; y: number } | null = null; // ⌥ + left: a click (eyedropper) or a drag (orbit)
  private leftDown = false;
  private keys = new Set<string>();
  private pending = { pressed: false, released: false, actions: new Set<DesktopAction>() };
  private offset = new Vector3();
  private right = new Vector3();
  private fwd = new Vector3();
  private upv = new Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDouble);
    canvas.addEventListener('contextmenu', this.onContext);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('lostpointercapture', this.cancel);
    window.addEventListener('blur', this.cancel);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDouble);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.cancel);
    window.removeEventListener('blur', this.cancel);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** Latch this frame's input (events arrive between frames). */
  poll(): void {
    this.pressed = this.pending.pressed;
    // A click that went down and up between two frames still needs a frame of "held".
    this.released = this.pending.released && !this.pending.pressed;
    const releaseLater = this.pending.released && this.pending.pressed;
    const swap = this.actions;
    swap.clear();
    this.actions = this.pending.actions;
    this.pending.actions = swap;
    this.pending.pressed = false;
    this.pending.released = releaseLater;
  }

  /** Queue an action from outside (the HUD's buttons). */
  push(action: DesktopAction): void {
    this.pending.actions.add(action);
  }

  get holding(): boolean {
    return this.leftDown;
  }

  setCursor(cursor: string): void {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  /** Put the orbit camera in place (camera is the non-XR browser camera); held keys move it. */
  applyCamera(camera: PerspectiveCamera, delta = 0): void {
    if (!this.busy && delta > 0) {
      const k = (key: string) => (this.keys.has(key) ? 1 : 0);
      const pan = this.distance * 0.9 * delta;
      this.fwd.set(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
      this.right.set(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
      this.target.addScaledVector(this.fwd, (k('w') - k('s')) * pan).addScaledVector(this.right, (k('d') - k('a')) * pan);
      this.azimuth += (k('q') - k('e')) * 1.6 * delta;
      this.elevation = Math.min(1.5, Math.max(-0.2, this.elevation + (k('pageup') - k('pagedown')) * 1.2 * delta));
      const zoom = k('=') + k('+') - k('-') - k('_');
      if (zoom) this.zoom(Math.exp(-zoom * 1.5 * delta));
    }
    const ce = Math.cos(this.elevation);
    this.offset.set(Math.sin(this.azimuth) * ce, Math.sin(this.elevation), Math.cos(this.azimuth) * ce).multiplyScalar(this.distance);
    camera.position.copy(this.target).add(this.offset);
    camera.lookAt(this.target);
    camera.updateMatrixWorld();
  }

  private zoom(f: number): void {
    this.distance = Math.min(4, Math.max(0.08, this.distance * f));
  }

  private orbit(dx: number, dy: number): void {
    this.azimuth -= dx * 0.006;
    this.elevation = Math.min(1.5, Math.max(-0.2, this.elevation + dy * 0.006));
  }

  /** Move the orbit target in the camera's plane, scaled so the grabbed spot tracks the cursor. */
  private pan(dx: number, dy: number): void {
    const k = (this.distance * 1.1) / this.canvas.clientHeight;
    this.right.set(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    // Screen-up, in the camera's plane.
    const se = Math.sin(this.elevation);
    const ce = Math.cos(this.elevation);
    this.upv.set(-Math.sin(this.azimuth) * se, ce, -Math.cos(this.azimuth) * se);
    this.target.addScaledVector(this.right, -dx * k).addScaledVector(this.upv, dy * k);
  }

  private toNdc(ev: { clientX: number; clientY: number }): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  private onDown = (ev: PointerEvent) => {
    if (!this.enabled || this.overHud(ev.clientX, ev.clientY)) return;
    this.toNdc(ev);
    if (ev.button === 0 && ev.altKey) {
      this.altPress = { x: ev.clientX, y: ev.clientY };
    } else if (ev.button === 0) {
      this.leftDown = true;
      this.pressNdc.copy(this.ndc);
      this.alt = false;
      this.shift = ev.shiftKey;
      this.pending.pressed = true;
    } else {
      this.drag = { mode: ev.button === 1 || ev.shiftKey ? 'pan' : 'orbit', x: ev.clientX, y: ev.clientY, moved: 0, button: ev.button };
    }
    this.canvas.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  };

  private onMove = (ev: PointerEvent) => {
    if (!this.enabled) return;
    this.toNdc(ev);
    // Chorded buttons don't fire pointerup: read the held buttons directly.
    if (this.leftDown && !(ev.buttons & 1)) this.release();
    if (this.altPress) {
      if (!(ev.buttons & 1)) this.altPress = null;
      else if (Math.hypot(ev.clientX - this.altPress.x, ev.clientY - this.altPress.y) > 4) {
        this.drag = { mode: 'orbit', x: this.altPress.x, y: this.altPress.y, moved: 5, button: 0 };
        this.altPress = null;
      }
    }
    if (this.drag && !(ev.buttons & (this.drag.button === 0 ? 1 : 6))) this.drag = null;
    if (!this.drag) return;
    const dx = ev.clientX - this.drag.x;
    const dy = ev.clientY - this.drag.y;
    this.drag.x = ev.clientX;
    this.drag.y = ev.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this.drag.mode === 'pan') this.pan(dx, dy);
    else this.orbit(dx, dy);
  };

  private onUp = (ev: PointerEvent) => {
    if (!this.enabled) return;
    if (ev.button === 0 && this.altPress) {
      // ⌥-click without a drag: the eyedropper.
      this.altPress = null;
      this.pending.actions.add('pick');
    } else if (ev.button === 0) this.release();
    else {
      if (ev.button === 2 && this.drag && this.drag.moved < 4) this.pending.actions.add('cancel'); // a right-click, not a drag
      this.drag = null;
    }
    if (ev.button === 0 && this.drag?.button === 0) this.drag = null;
  };

  private release(): void {
    if (!this.leftDown) return;
    this.leftDown = false;
    this.pending.released = true;
  }

  /** Focus lost or the pointer taken away mid-drag: let go rather than stick. */
  private cancel = () => {
    this.release();
    this.drag = null;
    this.altPress = null;
    this.keys.clear();
  };

  private onWheel = (ev: WheelEvent) => {
    if (!this.enabled) return;
    ev.preventDefault();
    if (ev.ctrlKey) {
      this.zoom(Math.exp(ev.deltaY * 0.01)); // trackpad pinch
      return;
    }
    if (ev.altKey) {
      this.orbit(ev.deltaX, ev.deltaY);
      return;
    }
    // A mouse wheel clicks in big whole steps (or lines) with no sideways part; a trackpad glides.
    const mouse = this.wheelMode === 'mouse' || (this.wheelMode === 'auto' && (ev.deltaMode !== 0 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 40 && Number.isInteger(ev.deltaY))));
    if (mouse) this.zoom(Math.exp(ev.deltaY * (ev.deltaMode ? 0.05 : 0.0012)));
    else this.pan(-ev.deltaX, -ev.deltaY);
  };

  private onDouble = (ev: MouseEvent) => {
    if (!this.enabled || this.overHud(ev.clientX, ev.clientY)) return;
    this.toNdc(ev);
    this.pending.actions.add('focus');
  };

  private onContext = (ev: Event) => {
    if (this.enabled) ev.preventDefault();
  };

  private typing(ev: KeyboardEvent): boolean {
    const t = ev.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onKey = (ev: KeyboardEvent) => {
    if (!this.enabled || this.typing(ev)) return;
    const key = ev.key.toLowerCase();
    if (HELD.has(key) && !ev.metaKey && !ev.ctrlKey) this.keys.add(key);
    if (ev.repeat) return;
    if (ev.metaKey || ev.ctrlKey) {
      if (key === 'z') this.pending.actions.add(ev.shiftKey ? 'redo' : 'undo');
      else if (META[key]) this.pending.actions.add(META[key]);
      else return;
      ev.preventDefault();
      return;
    }
    if (ev.altKey) return;
    let action = KEYS[key];
    if (key === 'r') action = ev.shiftKey ? 'spinL' : 'spinR';
    if (key === 't') action = ev.shiftKey ? 'tipU' : 'tipD';
    if (action) {
      this.pending.actions.add(action);
      ev.preventDefault();
    }
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.key.toLowerCase());
  };
}
