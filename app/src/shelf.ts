import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The parts shelf: a six-sided drum of cubbies that turns like a lazy Susan, one group of
// part categories per face, floating over a round base with a ring of paint jars (colors)
// and three sample tiles (finishes). This module builds it; StackerSystem decides what's
// in each cubby and handles the hands (see "parts shelf" there).

export interface DrumFace {
  label: string;
  tabs: string[]; // library tabs (PartDef.tab) shown on this face, in order
}

export const FACES: DrumFace[] = [
  { label: 'Bricks', tabs: ['Bricks'] },
  { label: 'Plates & Tiles', tabs: ['Plates', 'Tiles'] },
  { label: 'Slopes & Curves', tabs: ['Slopes', 'Curves', 'Wedges'] },
  { label: 'Round', tabs: ['Round'] },
  { label: 'Windows & Special', tabs: ['Windows', 'Special'] },
  { label: 'Figures & More', tabs: ['Minifigs', 'More'] },
];

export const COLS = 4;
export const ROWS = 3;
export const PER_FACE = COLS * ROWS;
export const FACE_STEP = Math.PI / 3; // 60° between faces

const R = 0.18; // center to face plane
export const FACE_W = 2 * R * Math.tan(Math.PI / 6);
const RIM = 0.006; // frame around the cubbies
export const CUBBY_W = (FACE_W - 2 * RIM) / COLS;
export const CUBBY_H = 0.058;
const DEPTH = 0.05;
const TOP_BAND = 0.026; // the face's sign
const BOTTOM_BAND = 0.022; // paging
export const FACE_H = TOP_BAND + ROWS * CUBBY_H + BOTTOM_BAND;
const CAP = 0.012;
const OUTER = R / Math.cos(Math.PI / 6) + 0.006; // caps' circumradius
export const DRUM_LIFT = 0.03; // the drum floats this far over its base
const BASE_R = OUTER + 0.07;
const BASE_H = 0.024;
export const JAR_R = 0.0085;
export const JAR_H = 0.024;
const JAR_RING = OUTER + 0.04;
export const PREVIEW_FIT = 0.036;
const OVERLAY_W = 512;
const OVERLAY_H = Math.round((OVERLAY_W * FACE_H) / FACE_W);

/** Where cubby `slot` sits on its face (face-local: x across, y up, z out of the face). */
export function cubbyCenter(slot: number): [number, number] {
  const c = slot % COLS;
  const r = Math.floor(slot / COLS);
  return [-FACE_W / 2 + RIM + CUBBY_W * (c + 0.5), FACE_H / 2 - TOP_BAND - CUBBY_H * (r + 0.5)];
}

export interface FaceView {
  group: Group;
  previews: Mesh[];
  overlay: { canvas: HTMLCanvasElement; tex: CanvasTexture };
  sign: Mesh; // hit box for the face's sign (tap a side face's sign to turn to it)
  prev: Mesh; // hit boxes for paging
  next: Mesh;
}

export interface Jar {
  group: Group;
  paint: Mesh;
  ring: Mesh;
  color: number; // palette index
  angle: number;
}

export interface SampleTile {
  group: Group;
  brick: Mesh;
  finish: number;
}

export class PartDrum {
  readonly root = new Group(); // moved by its handle; the base stays level under the drum
  readonly drum = new Group(); // turns about its up axis
  readonly faces: FaceView[] = [];
  readonly caps: Mesh[] = [];
  readonly bar: Mesh;
  readonly jars: Jar[] = [];
  readonly tiles: SampleTile[] = [];
  readonly frameMat: MeshStandardMaterial;
  angle = 0; // drum rotation (radians)
  target = 0; // where it eases to once let go
  hover: Mesh | null = null; // preview turning slowly under the pointer

  constructor(colorCount: number, finishCount: number, tileGeometry: BufferGeometry) {
    this.root.name = 'PartsShelf';
    this.frameMat = new MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.42 });
    const shelfMat = new MeshStandardMaterial({ color: 0xe4e6ea, roughness: 0.5 });
    const backMat = new MeshStandardMaterial({ color: 0xcfd3da, roughness: 0.6 });

    // One face's cubbies (shared by all six): back wall, shelves, dividers, side rims.
    const parts: BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => parts.push(new BoxGeometry(w, h, d).translate(x, y, z));
    const gridTop = FACE_H / 2 - TOP_BAND;
    const gridBottom = gridTop - ROWS * CUBBY_H;
    for (let r = 0; r <= ROWS; r++) box(FACE_W, 0.004, DEPTH, 0, gridTop - r * CUBBY_H, -DEPTH / 2);
    for (let c = 0; c <= COLS; c++) {
      const x = c === 0 ? -FACE_W / 2 + RIM / 2 : c === COLS ? FACE_W / 2 - RIM / 2 : -FACE_W / 2 + RIM + c * CUBBY_W;
      box(c === 0 || c === COLS ? RIM : 0.003, ROWS * CUBBY_H, DEPTH, x, (gridTop + gridBottom) / 2, -DEPTH / 2);
    }
    const shelfGeo = mergeGeometries(parts)!;
    const backGeo = new BoxGeometry(FACE_W, FACE_H, 0.004).translate(0, 0, -DEPTH);
    const bandGeo = mergeGeometries([new BoxGeometry(FACE_W, TOP_BAND, 0.008).translate(0, FACE_H / 2 - TOP_BAND / 2, -0.004), new BoxGeometry(FACE_W, BOTTOM_BAND, 0.008).translate(0, -FACE_H / 2 + BOTTOM_BAND / 2, -0.004)])!;
    for (let k = 0; k < FACES.length; k++) {
      const g = new Group();
      const th = k * FACE_STEP;
      g.position.set(R * Math.sin(th), 0, R * Math.cos(th));
      g.rotation.y = th;
      const shelves = new Mesh(shelfGeo, shelfMat);
      const back = new Mesh(backGeo, backMat);
      const bands = new Mesh(bandGeo, this.frameMat);
      for (const m of [shelves, back, bands]) {
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      }
      // Labels, sign and paging are drawn on a transparent overlay just in front of the face.
      const canvas = document.createElement('canvas');
      canvas.width = OVERLAY_W;
      canvas.height = OVERLAY_H;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      const overlay = new Mesh(new PlaneGeometry(FACE_W, FACE_H), new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
      overlay.position.z = 0.0015;
      overlay.renderOrder = 2;
      g.add(overlay);
      const hit = (w: number, h: number, x: number, y: number) => {
        const m = new Mesh(new BoxGeometry(w, h, 0.01), new MeshBasicMaterial());
        m.visible = false;
        m.position.set(x, y, 0);
        g.add(m);
        return m;
      };
      const sign = hit(FACE_W, TOP_BAND, 0, FACE_H / 2 - TOP_BAND / 2);
      const prev = hit(0.04, BOTTOM_BAND, -FACE_W / 2 + 0.024, -FACE_H / 2 + BOTTOM_BAND / 2);
      const next = hit(0.04, BOTTOM_BAND, FACE_W / 2 - 0.024, -FACE_H / 2 + BOTTOM_BAND / 2);
      const previews: Mesh[] = [];
      for (let s = 0; s < PER_FACE; s++) {
        const [x, y] = cubbyCenter(s);
        const p = new Mesh();
        p.name = 'ShelfItem';
        p.position.set(x, y + 0.004, -DEPTH * 0.45);
        p.visible = false;
        p.castShadow = true;
        previews.push(p);
        g.add(p);
      }
      this.drum.add(g);
      this.faces.push({ group: g, previews, overlay: { canvas, tex }, sign, prev, next });
    }
    // Hexagonal caps, top and bottom: grab one and swipe to turn the drum.
    const capGeo = new CylinderGeometry(OUTER, OUTER, CAP, 6, 1).rotateY(Math.PI / 6);
    for (const y of [FACE_H / 2 + CAP / 2, -FACE_H / 2 - CAP / 2]) {
      const cap = new Mesh(capGeo, this.frameMat);
      cap.name = 'ShelfCap';
      cap.position.y = y;
      cap.castShadow = cap.receiveShadow = true;
      this.drum.add(cap);
      this.caps.push(cap);
    }
    // Spindle into the base.
    const spindle = new Mesh(new CylinderGeometry(0.008, 0.008, DRUM_LIFT + 0.01, 12), new MeshStandardMaterial({ color: 0x9aa1ad, roughness: 0.3, metalness: 0.6 }));
    spindle.position.y = -FACE_H / 2 - CAP - (DRUM_LIFT + 0.01) / 2 + 0.005;
    this.drum.add(spindle);
    this.drum.position.y = FACE_H / 2 + CAP + DRUM_LIFT + BASE_H;
    this.root.add(this.drum);

    // Base: a round plinth with the jars round its front and the sample tiles on the right.
    const base = new Mesh(new CylinderGeometry(BASE_R, BASE_R + 0.004, BASE_H, 48), new MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.55 }));
    base.position.y = BASE_H / 2;
    base.receiveShadow = true;
    this.root.add(base);
    const glass = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false });
    const jarGeo = new CylinderGeometry(JAR_R, JAR_R * 0.92, JAR_H, 16, 1, true);
    const jarFloor = new CylinderGeometry(JAR_R * 0.92, JAR_R * 0.92, 0.002, 16);
    const paintGeo = new CylinderGeometry(JAR_R * 0.86, JAR_R * 0.82, JAR_H * 0.62, 16);
    const ringGeo = new TorusGeometry(JAR_R + 0.003, 0.0012, 6, 24).rotateX(Math.PI / 2);
    const ringMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    // Jars from the back left round the front to the right; tiles past them on the right.
    const a0 = -2.0;
    const a1 = 1.25;
    for (let k = 0; k < colorCount; k++) {
      const a = colorCount > 1 ? a0 + ((a1 - a0) * k) / (colorCount - 1) : 0;
      const g = new Group();
      g.position.set(JAR_RING * Math.sin(a), BASE_H, JAR_RING * Math.cos(a));
      const jar = new Mesh(jarGeo, glass);
      jar.position.y = JAR_H / 2;
      jar.renderOrder = 3;
      const floor = new Mesh(jarFloor, glass);
      floor.position.y = 0.001;
      const paint = new Mesh(paintGeo);
      paint.name = 'Jar';
      paint.position.y = (JAR_H * 0.62) / 2 + 0.002;
      paint.castShadow = true;
      const ring = new Mesh(ringGeo, ringMat);
      ring.position.y = 0.002;
      ring.visible = false;
      g.add(paint, jar, floor, ring);
      this.root.add(g);
      this.jars.push({ group: g, paint, ring, color: k, angle: a });
    }
    for (let f = 0; f < finishCount; f++) {
      const a = 1.48 + f * 0.24;
      const g = new Group();
      g.position.set((BASE_R - 0.035) * Math.sin(a), BASE_H, (BASE_R - 0.035) * Math.cos(a));
      g.rotation.y = a;
      const pedestal = new Mesh(new CylinderGeometry(0.016, 0.018, 0.008, 20), new MeshStandardMaterial({ color: 0x3a4152, roughness: 0.5 }));
      pedestal.position.y = 0.004;
      const brick = new Mesh(tileGeometry);
      brick.name = 'SampleTile';
      brick.position.y = 0.008 + 0.0048;
      brick.castShadow = true;
      g.add(pedestal, brick);
      this.root.add(g);
      this.tiles.push({ group: g, brick, finish: f });
    }
    // Move handle, like the panels', at the base's front.
    this.bar = new Mesh(new CapsuleGeometry(0.005, 0.08, 4, 10).rotateZ(Math.PI / 2), new MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 }));
    this.bar.name = 'ShelfHandle';
    this.bar.position.set(0, BASE_H / 2, BASE_R + 0.014);
    this.root.add(this.bar);
  }

  /** The face turned toward you (drum angle 0 shows face 0). */
  frontFace(): number {
    const k = Math.round(-this.angle / FACE_STEP);
    return ((k % FACES.length) + FACES.length) % FACES.length;
  }

  /** How far face k is turned away from you, in radians (−π..π). */
  faceAngle(k: number): number {
    let a = k * FACE_STEP + this.angle;
    a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return a;
  }

  /** Bounds for "over the shelf" (root-local): radius and height range. */
  contains(x: number, y: number, z: number): boolean {
    return Math.hypot(x, z) < OUTER + 0.03 && y > -0.02 && y < this.drum.position.y + FACE_H / 2 + CAP + 0.03;
  }

  /** Redraw a face's overlay: each cubby's name, the sign, and paging. */
  drawFace(k: number, names: string[], page: number, pages: number, front: boolean): void {
    const { canvas, tex } = this.faces[k].overlay;
    const c = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const sx = W / FACE_W;
    const sy = H / FACE_H;
    c.clearRect(0, 0, W, H);
    // Sign
    c.fillStyle = front ? '#1d2230' : '#3a4152';
    c.font = `800 ${Math.round(TOP_BAND * sy * 0.5)}px system-ui, -apple-system, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(FACES[k].label, W / 2, (TOP_BAND / 2) * sy + 2, W - 20);
    // Cubby names on the front lip of each shelf
    c.font = `600 ${Math.round(CUBBY_H * sy * 0.13)}px system-ui, -apple-system, sans-serif`;
    names.forEach((name, s) => {
      if (!name) return;
      const [x, y] = cubbyCenter(s);
      const px = (x + FACE_W / 2) * sx;
      const py = (FACE_H / 2 - (y - CUBBY_H / 2)) * sy - CUBBY_H * sy * 0.1;
      c.fillStyle = 'rgba(255,255,255,0.88)';
      const tw = Math.min(CUBBY_W * sx - 8, c.measureText(name).width + 10);
      c.beginPath();
      c.roundRect(px - tw / 2, py - CUBBY_H * sy * 0.08, tw, CUBBY_H * sy * 0.16, 6);
      c.fill();
      c.fillStyle = '#2a2f3a';
      c.fillText(name, px, py + 1, CUBBY_W * sx - 12);
    });
    // Paging
    if (pages > 1) {
      const py = H - (BOTTOM_BAND / 2) * sy;
      c.fillStyle = '#2a2f3a';
      c.font = `700 ${Math.round(BOTTOM_BAND * sy * 0.5)}px system-ui, -apple-system, sans-serif`;
      c.fillText(`${page + 1} / ${pages}`, W / 2, py + 1);
      c.font = `800 ${Math.round(BOTTOM_BAND * sy * 0.6)}px system-ui, -apple-system, sans-serif`;
      c.fillStyle = page > 0 ? '#2a2f3a' : 'rgba(42,47,58,0.25)';
      c.fillText('◀', 0.024 * sx, py + 1);
      c.fillStyle = page < pages - 1 ? '#2a2f3a' : 'rgba(42,47,58,0.25)';
      c.fillText('▶', W - 0.024 * sx, py + 1);
    }
    tex.needsUpdate = true;
  }
}
