import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  Box3,
  Sphere,
} from '@iwsdk/core';
import type { BufferGeometry, Material, Matrix4 } from '@iwsdk/core';
import { makeEnvScene } from './look.js';

// Kit boxes: product boxes on a rack. Their art is rendered from the kit's own model,
// so every kit gets a box without shipping anyone's packaging.

export interface KitInfo {
  id: string;
  title: string;
  pieces: number;
  color: string; // box color
  mine?: boolean; // boxed from your own build (front is your photo)
}

export interface ArtPiece {
  geometry: BufferGeometry;
  material: Material;
  matrix: Matrix4;
}

/** rack: on its slot · held: in a hand · loose: floating where it was let go · returning/opening: animating */
export type BoxState = 'rack' | 'held' | 'loose' | 'returning' | 'opening';

export const TEAR_PULL = 0.09; // meters the strip's tab has to travel to tear it off

const ART = 640;
// Manual views look from the front-right, a little above: close to classic instruction booklets.
const ISO = new Vector3(0.75, 0.72, 1).normalize();
const FACE_W = 768;
const STRIP_W = 0.012;
const STRIP_H = 0.0012;

export class KitBox {
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly mesh: Mesh;
  readonly strip: Mesh;
  readonly tab: Mesh;
  readonly peel: Mesh;
  readonly warn: Mesh;
  state: BoxState = 'rack';
  readonly slotPos = new Vector3(); // rack-local
  readonly slotQuat = new Quaternion();
  readonly fromPos = new Vector3(); // animation start (world)
  readonly fromQuat = new Quaternion();
  t = 0;
  tear = 0;
  private readonly faces: Array<{ canvas: HTMLCanvasElement; tex: CanvasTexture }> = [];

  constructor(readonly kit: KitInfo) {
    this.w = 0.1 + 0.06 * Math.sqrt(Math.min(kit.pieces, 400) / 363);
    this.h = this.w * 0.72;
    this.d = Math.max(0.045, this.w * 0.32);
    // BoxGeometry groups: +x, -x, +y (top), -y, +z (front), -z (back).
    const sizes: Array<[number, number]> = [
      [256, Math.round((256 * this.h) / this.d)],
      [256, Math.round((256 * this.h) / this.d)],
      [512, Math.round((512 * this.d) / this.w)],
      [16, 16],
      [FACE_W, Math.round((FACE_W * this.h) / this.w)],
      [FACE_W, Math.round((FACE_W * this.h) / this.w)],
    ];
    const mats = sizes.map(([cw, ch]) => {
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      this.faces.push({ canvas, tex });
      return new MeshStandardMaterial({ map: tex, roughness: 0.5 });
    });
    this.mesh = new Mesh(new BoxGeometry(this.w, this.h, this.d), mats);
    this.mesh.name = `KitBox ${kit.id}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Tear strip across the top near the front; its tab sticks out past the right edge.
    const stripMat = new MeshStandardMaterial({ map: stripTexture(kit.color), roughness: 0.4 });
    this.strip = new Mesh(new BoxGeometry(1, 1, 1).translate(0.5, 0, 0), stripMat);
    this.strip.position.set(-this.w / 2, this.h / 2 + STRIP_H / 2, this.d / 2 - STRIP_W / 2 - 0.004);
    this.strip.scale.set(this.w, STRIP_H, STRIP_W);
    this.tab = new Mesh(new BoxGeometry(0.016, 0.002, STRIP_W + 0.002), stripMat);
    this.tab.position.set(this.w / 2 + 0.006, this.h / 2 + 0.001, this.strip.position.z);
    this.tab.rotation.z = 0.35;
    this.peel = new Mesh(new BoxGeometry(1, 1, 1).translate(0.5, 0, 0), stripMat);
    this.peel.visible = false;
    const warnCanvas = labelCanvas('Opening clears your current build', '#fde047');
    const warnTex = new CanvasTexture(warnCanvas);
    warnTex.colorSpace = SRGBColorSpace;
    this.warn = new Mesh(new PlaneGeometry(0.16, 0.02), new MeshBasicMaterial({ map: warnTex, transparent: true, toneMapped: false, depthTest: false }));
    this.warn.position.set(0, this.h / 2 + 0.03, this.d / 2);
    this.warn.renderOrder = 30;
    this.warn.visible = false;
    this.mesh.add(this.strip, this.tab, this.peel, this.warn);
    this.paint(null, null, 0);
  }

  /** Draw every face; `front`/`back` are model renders (null while they're being made). */
  paint(front: HTMLCanvasElement | null, back: HTMLCanvasElement | null, steps: number): void {
    const k = this.kit;
    const [px, nx, top, bottom, fr, bk] = this.faces;
    drawSide(px.canvas, k);
    drawSide(nx.canvas, k);
    drawTop(top.canvas, k);
    const c = bottom.canvas.getContext('2d')!;
    c.fillStyle = shade(k.color, -0.35);
    c.fillRect(0, 0, 16, 16);
    drawFront(fr.canvas, k, front);
    drawBack(bk.canvas, k, back, steps);
    for (const f of this.faces) f.tex.needsUpdate = true;
  }

  /** Tear progress 0–1, with the peeled-off part running from the strip to `hand` (world). */
  setTear(t: number, hand: Vector3 | null): void {
    this.tear = t;
    this.strip.scale.x = Math.max(1e-4, this.w * (1 - t));
    this.tab.visible = t === 0;
    this.peel.visible = t > 0 && !!hand;
    if (!hand || t === 0) return;
    const start = new Vector3(-this.w / 2 + this.w * (1 - t), this.h / 2 + STRIP_H, this.strip.position.z);
    const end = this.mesh.worldToLocal(hand.clone());
    const dir = end.sub(start);
    const len = Math.min(dir.length(), 0.3);
    this.peel.position.copy(start);
    this.peel.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), dir.normalize());
    this.peel.scale.set(Math.max(len, 1e-4), STRIP_H, STRIP_W);
  }
}

/** Renders kit models for box art in a small context of its own; dispose when done. */
export class ArtRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(26, 1, 0.01, 10);
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.001, 10);
  private lastW = ART;
  private lastH = ART;

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(ART, ART, false);
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x000000, 0);
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(makeEnvScene('studio'), 0.04).texture;
    pmrem.dispose();
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(1.5, 3, 2.2);
    this.scene.add(key, new HemisphereLight(0xffffff, 0x404040, 0.7));
  }

  /**
   * The model seen from a given camera (model space, meters) into `out`, square, on a
   * transparent background: the box camera's viewfinder and photo.
   */
  renderView(group: Object3D, pos: Vector3, quat: Quaternion, fov: number, out: HTMLCanvasElement): HTMLCanvasElement {
    this.scene.add(group);
    group.updateMatrixWorld(true);
    const cam = this.camera;
    cam.fov = fov;
    cam.aspect = 1;
    cam.near = 0.005;
    cam.far = 20;
    cam.clearViewOffset();
    cam.position.copy(pos);
    cam.quaternion.copy(quat);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.renderer.setSize(out.width, out.height, false);
    this.renderer.render(this.scene, cam);
    const ctx = out.getContext('2d')!;
    ctx.clearRect(0, 0, out.width, out.height);
    ctx.drawImage(this.renderer.domElement, 0, 0);
    this.renderer.setSize(ART, ART, false);
    this.scene.remove(group);
    return out;
  }

  /** The model from the front-right (front) or back-left (back), on a transparent canvas. */
  render(pieces: ArtPiece[], view: 'front' | 'back'): HTMLCanvasElement {
    const group = new Group();
    for (const p of pieces) {
      const m = new Mesh(p.geometry, p.material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(p.matrix);
      group.add(m);
    }
    this.scene.add(group);
    group.updateMatrixWorld(true);
    const sphere = new Box3().setFromObject(group).getBoundingSphere(new Sphere());
    const dir = view === 'front' ? new Vector3(0.95, 0.8, 1.35) : new Vector3(-1.1, 0.75, -1.25);
    dir.normalize();
    const dist = sphere.radius / Math.sin(((this.camera.fov / 2) * Math.PI) / 180);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.001, dist - sphere.radius * 2);
    this.camera.far = dist + sphere.radius * 2;
    this.camera.lookAt(sphere.center);
    this.camera.clearViewOffset();
    this.camera.updateMatrixWorld();
    // Crop the view to the model's projected bounds so wide, flat models fill the art too.
    const b = new Box3().setFromObject(group);
    const lo = new Vector3(Infinity, Infinity, 0);
    const hi = new Vector3(-Infinity, -Infinity, 0);
    const c = new Vector3();
    for (let k = 0; k < 8; k++) {
      c.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).project(this.camera);
      lo.min(c);
      hi.max(c);
    }
    const size = Math.max(hi.x - lo.x, hi.y - lo.y) * 1.04; // box corners overshoot the model a little already
    const sub = (size / 2) * ART;
    const cx = ((lo.x + hi.x) / 2 + 1) / 2;
    const cy = (1 - (lo.y + hi.y) / 2) / 2;
    this.camera.setViewOffset(ART, ART, cx * ART - sub / 2, cy * ART - sub / 2, sub, sub);
    this.renderer.render(this.scene, this.camera);
    const out = document.createElement('canvas');
    out.width = out.height = ART;
    out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    this.scene.remove(group);
    return out;
  }

  /**
   * A flat isometric view of `group` (instruction-manual style), w×h pixels on a transparent
   * canvas. `frame` fixes the framing (defaults to the group's own bounds).
   */
  renderIso(group: Object3D, w: number, h: number, frame?: Box3): HTMLCanvasElement {
    this.scene.add(group);
    group.updateMatrixWorld(true);
    const box = frame ?? new Box3().setFromObject(group);
    const center = box.getCenter(new Vector3());
    const r = Math.max(box.getSize(new Vector3()).length(), 1e-3);
    const cam = this.ortho;
    cam.position.copy(center).addScaledVector(ISO, r * 2);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const lo = new Vector3(Infinity, Infinity, 0);
    const hi = new Vector3(-Infinity, -Infinity, 0);
    const c = new Vector3();
    for (let k = 0; k < 8; k++) {
      c.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
      lo.min(c);
      hi.max(c);
    }
    // Box corners overshoot the model's silhouette, so the margin is small.
    let hw = ((hi.x - lo.x) / 2) * 1.02;
    let hh = ((hi.y - lo.y) / 2) * 1.02;
    if (hw / hh > w / h) hh = (hw * h) / w;
    else hw = (hh * w) / h;
    const cx = (lo.x + hi.x) / 2;
    const cy = (lo.y + hi.y) / 2;
    cam.left = cx - hw;
    cam.right = cx + hw;
    cam.top = cy + hh;
    cam.bottom = cy - hh;
    cam.near = 0.0001;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
    // Fat lines are sized in pixels: tell their materials the canvas size.
    group.traverse((o) => {
      const m = (o as Mesh).material as { isLineMaterial?: boolean; resolution?: { set(x: number, y: number): void } };
      if (m?.isLineMaterial) m.resolution!.set(w, h);
    });
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, cam);
    this.lastW = w;
    this.lastH = h;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    this.renderer.setSize(ART, ART, false);
    this.scene.remove(group);
    return out;
  }

  /** Where a world point landed in the last isometric render, in its canvas pixels. */
  project(p: Vector3): [number, number] {
    const v = p.clone().project(this.ortho);
    return [((v.x + 1) / 2) * this.lastW, ((1 - v.y) / 2) * this.lastH];
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// ---------------------------------------------------------------- drawing

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function shade(hex: string, amt: number): string {
  const c = new Color(hex);
  return amt >= 0 ? `#${c.lerp(new Color(0xffffff), amt).getHexString()}` : `#${c.lerp(new Color(0x000000), -amt).getHexString()}`;
}

function brand(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // Four studs, then the wordmark.
  ctx.fillStyle = '#ffffff';
  const r = size * 0.16;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    ctx.beginPath();
    ctx.arc(x + r + dx * r * 2.4, y - size * 0.38 + r + dy * r * 2.4, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('STACKER', x + r * 5.4, y + size * 0.36);
}

function background(ctx: CanvasRenderingContext2D, W: number, H: number, color: string, glowX: number, glowY: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, shade(color, 0.28));
  g.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, H * 0.62);
  r.addColorStop(0, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
}

function drawArt(ctx: CanvasRenderingContext2D, art: HTMLCanvasElement | null, cx: number, cy: number, size: number, photo = false): void {
  if (photo) {
    // Your own framing: no floor shadow, the shot as taken.
    if (art) ctx.drawImage(art, cx - size / 2, cy - size / 2, size, size);
    return;
  }
  // Soft floor shadow, then the model.
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.filter = 'blur(14px)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.36, size * 0.34, size * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (art) ctx.drawImage(art, cx - size / 2, cy - size / 2, size, size);
}

function drawFront(canvas: HTMLCanvasElement, k: KitInfo, art: HTMLCanvasElement | null): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  background(ctx, W, H, k.color, W * 0.56, H * 0.5);
  // Brand bar
  ctx.fillStyle = 'rgba(10,12,20,0.55)';
  ctx.fillRect(0, 0, W, H * 0.13);
  brand(ctx, W * 0.035, H * 0.065, H * 0.07);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `600 ${H * 0.045}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(k.mine ? 'Your build' : `No. ${k.id.replace(/-1$/, '')}`, W * 0.965, H * 0.067);
  drawArt(ctx, art, W * 0.58, H * 0.54, H * 0.84, !!k.mine);
  // Title
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 ${H * 0.12}px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = H * 0.02;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(k.title, W * 0.04, H * 0.93);
  ctx.shadowBlur = 0;
  // Piece badge
  const label = `${k.pieces} pcs`;
  ctx.font = `800 ${H * 0.055}px ${FONT}`;
  const bw = ctx.measureText(label).width + H * 0.06;
  const bh = H * 0.09;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(W * 0.96 - bw, H * 0.84, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = shade(k.color, -0.2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W * 0.96 - bw / 2, H * 0.84 + bh / 2);
}

function drawBack(canvas: HTMLCanvasElement, k: KitInfo, art: HTMLCanvasElement | null, steps: number): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  background(ctx, W, H, shade(k.color, -0.15), W * 0.32, H * 0.5);
  drawArt(ctx, art, W * 0.32, H * 0.52, H * 0.8);
  ctx.fillStyle = 'rgba(10,12,20,0.5)';
  ctx.beginPath();
  ctx.roundRect(W * 0.62, H * 0.12, W * 0.34, H * 0.76, H * 0.04);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const x = W * 0.65;
  ctx.font = `800 ${H * 0.075}px ${FONT}`;
  ctx.fillText(k.title, x, H * 0.24, W * 0.29);
  ctx.font = `600 ${H * 0.05}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const lines = [`${k.pieces} pieces`, steps ? `${steps} steps` : '', 'Ghost guides', 'or a paged manual'];
  lines.forEach((l, i) => l && ctx.fillText(l, x, H * (0.38 + i * 0.1)));
  ctx.font = `600 ${H * 0.04}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Pull the strip on top to open', x, H * 0.82, W * 0.29);
}

function drawSide(canvas: HTMLCanvasElement, k: KitInfo): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = shade(k.color, -0.08);
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${W * 0.3}px ${FONT}`;
  ctx.fillText(k.title, 0, -W * 0.08, H * 0.8);
  ctx.font = `600 ${W * 0.16}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`${k.pieces} pcs`, 0, W * 0.24);
  ctx.restore();
}

function drawTop(canvas: HTMLCanvasElement, k: KitInfo): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = shade(k.color, -0.12);
  ctx.fillRect(0, 0, W, H);
  // Canvas top is the box's back edge; the strip runs along the front (bottom).
  brand(ctx, W * 0.05, H * 0.32, H * 0.2);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${H * 0.2}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(k.title, W * 0.95, H * 0.32, W * 0.5);
}

function stripTexture(color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = shade(color, -0.2);
  for (let x = 8; x < 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x + 14, 6);
    ctx.lineTo(x, 16);
    ctx.lineTo(x + 14, 26);
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function labelCanvas(text: string, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(16,19,28,0.9)';
  ctx.beginPath();
  ctx.roundRect(0, 0, 1024, 128, 64);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `700 60px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 68);
  return canvas;
}
