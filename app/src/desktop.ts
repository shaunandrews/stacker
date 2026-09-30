import { PerspectiveCamera, Vector2, Vector3 } from '@iwsdk/core';

// Mouse-and-keyboard input for exploring and testing on a laptop, outside XR.
// The system reads it once a frame as a virtual right hand (a ray from the camera
// through the cursor) and drives an orbit camera around the platform.
//
//   left-drag            grab / press / drag (Alt: duplicate, Shift-click: select)
//   right-drag           orbit        Shift + right-drag or middle-drag: pan
//   wheel                zoom         F: frame the platform
//   Q / E, ← / →         turn the held block      ↑ / ↓: tip it
//   Delete / Backspace   delete       1 2 3: Build / Select / Paint
//   ⌘/Ctrl + Z           undo (Shift: redo)

export type DesktopAction = 'spinL' | 'spinR' | 'tipU' | 'tipD' | 'delete' | 'undo' | 'redo' | 'frame' | 'tool1' | 'tool2' | 'tool3';

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
  '1': 'tool1',
  '2': 'tool2',
  '3': 'tool3',
};

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

  // Orbit camera
  readonly target = new Vector3();
  azimuth = 0;
  elevation = 0.55;
  distance = 0.8;

  private drag: { pan: boolean; x: number; y: number } | null = null;
  private leftDown = false;
  private pending = { pressed: false, released: false, actions: new Set<DesktopAction>() };
  private offset = new Vector3();
  private right = new Vector3();
  private upv = new Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContext);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('lostpointercapture', this.cancel);
    window.addEventListener('blur', this.cancel);
    window.addEventListener('keydown', this.onKey);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.cancel);
    window.removeEventListener('blur', this.cancel);
    window.removeEventListener('keydown', this.onKey);
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

  get holding(): boolean {
    return this.leftDown;
  }

  setCursor(cursor: string): void {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  /** Put the orbit camera in place (camera is the non-XR browser camera). */
  applyCamera(camera: PerspectiveCamera): void {
    const ce = Math.cos(this.elevation);
    this.offset.set(Math.sin(this.azimuth) * ce, Math.sin(this.elevation), Math.cos(this.azimuth) * ce).multiplyScalar(this.distance);
    camera.position.copy(this.target).add(this.offset);
    camera.lookAt(this.target);
    camera.updateMatrixWorld();
  }

  private toNdc(ev: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  private onDown = (ev: PointerEvent) => {
    if (!this.enabled) return;
    this.toNdc(ev);
    if (ev.button === 0) {
      this.leftDown = true;
      this.pressNdc.copy(this.ndc);
      this.alt = ev.altKey;
      this.shift = ev.shiftKey;
      this.pending.pressed = true;
    } else {
      this.drag = { pan: ev.button === 1 || ev.shiftKey, x: ev.clientX, y: ev.clientY };
    }
    this.canvas.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  };

  private onMove = (ev: PointerEvent) => {
    if (!this.enabled) return;
    this.toNdc(ev);
    // Chorded buttons don't fire pointerup: read the held buttons directly.
    if (this.leftDown && !(ev.buttons & 1)) this.release();
    if (this.drag && !(ev.buttons & 6)) this.drag = null;
    if (!this.drag) return;
    const dx = ev.clientX - this.drag.x;
    const dy = ev.clientY - this.drag.y;
    this.drag.x = ev.clientX;
    this.drag.y = ev.clientY;
    if (this.drag.pan) {
      // Move the orbit target in the camera's plane, scaled so the grabbed spot tracks the cursor.
      const k = (this.distance * 1.1) / this.canvas.clientHeight;
      this.right.set(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
      this.upv.set(0, 1, 0);
      this.target.addScaledVector(this.right, -dx * k).addScaledVector(this.upv, dy * k);
    } else {
      this.azimuth -= dx * 0.006;
      this.elevation = Math.min(1.5, Math.max(-0.2, this.elevation + dy * 0.006));
    }
  };

  private onUp = (ev: PointerEvent) => {
    if (!this.enabled) return;
    if (ev.button === 0) this.release();
    else this.drag = null;
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
  };

  private onWheel = (ev: WheelEvent) => {
    if (!this.enabled) return;
    ev.preventDefault();
    this.distance = Math.min(3, Math.max(0.12, this.distance * Math.exp(ev.deltaY * 0.0012)));
  };

  private onContext = (ev: Event) => {
    if (this.enabled) ev.preventDefault();
  };

  private onKey = (ev: KeyboardEvent) => {
    if (!this.enabled || ev.repeat) return;
    const key = ev.key.toLowerCase();
    if ((ev.metaKey || ev.ctrlKey) && key === 'z') {
      this.pending.actions.add(ev.shiftKey ? 'redo' : 'undo');
      ev.preventDefault();
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const action = KEYS[key];
    if (action) {
      this.pending.actions.add(action);
      ev.preventDefault();
    }
  };
}
