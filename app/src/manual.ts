import {
  Box3,
  Color,
  DataTexture,
  EdgesGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  Vector3,
} from '@iwsdk/core';
import type { BufferGeometry, Material } from '@iwsdk/core';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { dims } from './blocks.js';
import type { Library } from './blocks.js';
import { ArtRenderer } from './kit-boxes.js';
import { kitPiece } from './kits.js';
import type { KitBlock } from './kits.js';
import { patchBlockShader } from './look.js';

// Manual pages, drawn like a printed instruction booklet. Shared by the in-XR manual
// panel and the catalog (catalog.html), so what you audit is what you get.

export const MANUAL_ZOOM = [1, 1.7, 2.8, 4.5];

export class ManualPainter {
  private art: ArtRenderer | null = null;
  private readonly colors: Color[];
  private readonly thumbs = new Map<string, HTMLCanvasElement>();
  private readonly toonMats = new Map<number, Material>();
  private readonly inkGeos = new Map<number, LineSegmentsGeometry>();
  private readonly edgeGeos = new Map<number, BufferGeometry>();
  private readonly inkMat = new LineMaterial({ color: 0x1d1f24, linewidth: 3 });
  private readonly inkLightMat = new LineMaterial({ color: 0x8a8f99, linewidth: 2.5 }); // outlines on near-black parts
  private toonRamp: DataTexture | null = null;

  /** `edges` shares edge geometry with the caller (the ghosts use the same). */
  constructor(
    private readonly lib: Library,
    private readonly edges?: (part: number) => BufferGeometry,
  ) {
    this.colors = lib.linearColors();
  }

  /**
   * Page `n` of `steps` onto `canvas`: a circled step number, a callout of the parts it
   * needs, and the model built so far in flat, outlined isometric, with this step's
   * parts floating just above their spots and dashed arrows down into place.
   * `zoom` indexes MANUAL_ZOOM.
   */
  paint(canvas: HTMLCanvasElement, steps: KitBlock[][], n: number, zoomLevel = 0): void {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const font = 'system-ui, -apple-system, sans-serif';
    const ink = '#1d1f24';
    this.art ??= new ArtRenderer();
    const art = this.art;
    const px = W / 1024; // stroke sizes are tuned at 1024 wide
    ctx.fillStyle = '#f7f1e3';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5 * px;
    ctx.beginPath();
    ctx.roundRect(12 * px, 12 * px, W - 24 * px, H - 24 * px, 22 * px);
    ctx.stroke();

    // Circled step number
    const r = W * 0.075;
    const nx = W * 0.05 + r;
    const ny = W * 0.05 + r;
    ctx.lineWidth = 6 * px;
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `800 ${Math.round(r * (n + 1 > 9 ? 0.95 : 1.2))}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n + 1), nx, ny + r * 0.06);

    // Parts callout, top right
    const counts = new Map<string, { part: number; color: number; n: number }>();
    for (const b of steps[n]) {
      const part = this.lib.byId.get(b.part);
      if (part === undefined) continue;
      const key = `${part}:${b.color}`;
      const c = counts.get(key) ?? { part, color: this.lib.colorIndex.get(b.color) ?? 0, n: 0 };
      c.n++;
      counts.set(key, c);
    }
    const entries = [...counts.values()];
    const thumb = Math.round(W * 0.15);
    const gap = Math.round(W * 0.015);
    const pad = Math.round(W * 0.022);
    const right = W * 0.95;
    const maxW = right - (nx + r + W * 0.05);
    const perRow = Math.max(1, Math.floor((maxW - pad * 2 + gap) / (thumb + gap)));
    const rows = Math.ceil(entries.length / perRow);
    const cols = Math.min(perRow, entries.length);
    const bw = pad * 2 + cols * thumb + (cols - 1) * gap;
    const bh = pad * 2 + rows * thumb + (rows - 1) * gap;
    const bx = right - bw;
    const by = W * 0.05;
    ctx.fillStyle = '#cfe3f3';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 14 * px);
    ctx.fill();
    ctx.stroke();
    entries.forEach((e, k) => {
      const x = bx + pad + (k % perRow) * (thumb + gap);
      const y = by + pad + Math.floor(k / perRow) * (thumb + gap);
      ctx.drawImage(this.partThumb(e.part, e.color), x, y, thumb, thumb * 0.8);
      ctx.fillStyle = ink;
      ctx.font = `800 ${Math.round(thumb * 0.22)}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${e.n}x`, x + thumb / 2, y + thumb + 2);
    });

    // The model so far; this step's parts lifted along their own up axis.
    const top = Math.max(by + bh, ny + r) + W * 0.02;
    const areaH = Math.max(64, Math.round(H - top - W * 0.04));
    const model = new Group();
    const arrows: Array<[Vector3, Vector3]> = [];
    const fresh: Mesh[] = [];
    const lift = 0.02;
    // Parts already built, as boxes: a new part floats out along whichever way it can
    // slide free of them (up for bricks on studs, sideways for tyres onto hubs).
    const built: Box3[] = [];
    steps.slice(0, n).forEach((step) => {
      for (const b of step) {
        const piece = kitPiece(this.lib, b, 0, 0);
        if (piece) built.push(this.lib.geometries[piece.part].boundingBox!.clone().applyMatrix4(piece.m).expandByScalar(-0.0004));
      }
    });
    const middle = new Box3();
    for (const b of built) middle.union(b);
    const mid = middle.isEmpty() ? new Vector3() : middle.getCenter(new Vector3());
    steps.slice(0, n + 1).forEach((step, k) => {
      for (const b of step) {
        const piece = kitPiece(this.lib, b, 0, 0);
        if (!piece) continue;
        const m = piece.m.clone();
        if (k === n) {
          const box = this.lib.geometries[piece.part].boundingBox!.clone().applyMatrix4(m);
          const dir = liftDirection(box, built, mid);
          const at = new Vector3().setFromMatrixPosition(m);
          const reach = Math.abs(dir.x) * (box.max.x - box.min.x) + Math.abs(dir.y) * (box.max.y - box.min.y) + Math.abs(dir.z) * (box.max.z - box.min.z);
          arrows.push([at.clone().addScaledVector(dir, lift - reach * 0.1), at.clone().addScaledVector(dir, reach / 2)]);
          m.premultiply(new Matrix4().makeTranslation(dir.x * lift, dir.y * lift, dir.z * lift));
        }
        const mesh = this.addInked(model, piece.part, piece.color, m);
        if (k === n) fresh.push(mesh);
      }
    });
    // Frame the whole model while it's small next to this step; zoom in on the step's
    // area once it's big (like booklets do for large sets).
    model.updateMatrixWorld(true);
    const all = new Box3().setFromObject(model);
    const step = new Box3();
    for (const mesh of fresh) step.expandByObject(mesh);
    for (const [, to] of arrows) step.expandByPoint(to);
    const stepSize = step.isEmpty() ? 0 : step.getSize(new Vector3()).length();
    let frame = all;
    if (!step.isEmpty() && all.getSize(new Vector3()).length() > Math.max(0.14, stepSize * 3)) {
      frame = step.clone().expandByScalar(Math.max(0.02, stepSize * 0.25));
    }
    // Zoomed in: a smaller window around this step's parts.
    const zoom = MANUAL_ZOOM[zoomLevel] ?? 1;
    if (zoom > 1) {
      const center = step.isEmpty() ? frame.getCenter(new Vector3()) : step.getCenter(new Vector3());
      frame = new Box3().setFromCenterAndSize(center, frame.getSize(new Vector3()).divideScalar(zoom));
    }
    // Lines scale with how big a stud is drawn: bold up close, fine when everything's tiny.
    const studPx = (dims.pitch * (W - 60)) / Math.max(1e-3, frame.getSize(new Vector3()).length() * 0.8);
    this.inkMat.linewidth = Math.min(9, Math.max(1.4, studPx * 0.11));
    this.inkLightMat.linewidth = this.inkMat.linewidth * 0.8;
    const image = art.renderIso(model, W - 60, areaH, frame);
    ctx.drawImage(image, 30, top);
    // Dashed arrows from each lifted part down to its spot.
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 5 * px;
    for (const [from, to] of arrows.slice(0, 10)) {
      const [x0, y0] = art.project(from);
      const [x1, y1] = art.project(to);
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 18 * (W / 1024)) continue;
      const ax = 30 + x0;
      const ay = top + y0;
      const bx2 = 30 + x1;
      const by2 = top + y1;
      const ux = (bx2 - ax) / len;
      const uy = (by2 - ay) / len;
      ctx.setLineDash([12 * px, 9 * px]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx2 - ux * 18 * px, by2 - uy * 18 * px);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(bx2, by2);
      ctx.lineTo(bx2 - (ux * 24 + uy * 13) * px, by2 + (-uy * 24 + ux * 13) * px);
      ctx.lineTo(bx2 - (ux * 24 - uy * 13) * px, by2 + (-uy * 24 - ux * 13) * px);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** A part on its own, drawn like the manual's callouts (400×320, transparent). */
  partThumb(part: number, color: number): HTMLCanvasElement {
    const key = `${part}:${color}`;
    let c = this.thumbs.get(key);
    if (!c) {
      this.art ??= new ArtRenderer();
      const g = new Group();
      this.addInked(g, part, color, new Matrix4());
      const width = this.inkMat.linewidth;
      this.inkMat.linewidth = this.inkLightMat.linewidth = 3;
      c = this.art.renderIso(g, 400, 320);
      this.inkMat.linewidth = width;
      this.inkLightMat.linewidth = width * 0.8;
      this.thumbs.set(key, c);
    }
    return c;
  }

  /** Frees the rendering context; caches stay for the next page. */
  dispose(): void {
    this.art?.dispose();
    this.art = null;
  }

  private edgeGeo(part: number): BufferGeometry {
    if (this.edges) return this.edges(part);
    let g = this.edgeGeos.get(part);
    if (!g) {
      g = new EdgesGeometry(this.lib.geometries[part], 30);
      this.edgeGeos.set(part, g);
    }
    return g;
  }

  /** A part drawn manual-style: flat shaded with a bold outline. */
  private addInked(group: Group, part: number, color: number, m: Matrix4): Mesh {
    const mesh = new Mesh(this.lib.geometries[part], this.toonMat(color));
    let lines = this.inkGeos.get(part);
    if (!lines) {
      lines = new LineSegmentsGeometry().fromEdgesGeometry(this.edgeGeo(part) as EdgesGeometry);
      this.inkGeos.set(part, lines);
    }
    const ink = new LineSegments2(lines, this.isDark(color) ? this.inkLightMat : this.inkMat);
    for (const o of [mesh, ink]) {
      o.matrixAutoUpdate = false;
      o.matrix.copy(m);
      group.add(o);
    }
    return mesh;
  }

  private isDark(color: number): boolean {
    const c = this.colors[color];
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.04;
  }

  /** Cel-shaded block color for manual pages: three flat tones, printed details kept. */
  private toonMat(color: number): Material {
    let m = this.toonMats.get(color);
    if (!m) {
      if (!this.toonRamp) {
        this.toonRamp = new DataTexture(new Uint8Array([120, 190, 255]), 3, 1, RedFormat);
        this.toonRamp.minFilter = this.toonRamp.magFilter = NearestFilter;
        this.toonRamp.needsUpdate = true;
      }
      const see = this.lib.isTrans(color);
      // Near-black prints as dark grey, like booklets do, so its shape still reads.
      const c = this.isDark(color) ? new Color(0.07, 0.075, 0.085) : this.colors[color];
      m = patchBlockShader(new MeshToonMaterial({ color: c, gradientMap: this.toonRamp, transparent: see, opacity: see ? 0.5 : 1, depthWrite: !see }));
      this.toonMats.set(color, m);
    }
    return m;
  }
}

/**
 * Which way a new part comes in: up if it can slide up free of what's built, else
 * outward to the side, else down. Parts it already overlaps (what it attaches to)
 * don't block it.
 */
function liftDirection(box: Box3, built: Box3[], mid: Vector3): Vector3 {
  const blockers = built.filter((b) => !b.intersectsBox(box));
  const out = box.getCenter(new Vector3()).sub(mid);
  const sides = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)].sort((a, b) => b.dot(out) - a.dot(out));
  const swept = new Box3();
  for (const dir of [new Vector3(0, 1, 0), ...sides, new Vector3(0, -1, 0)]) {
    swept.copy(box).union(box.clone().translate(dir.clone().multiplyScalar(0.02)));
    if (!blockers.some((b) => b.intersectsBox(swept))) return dir;
  }
  return new Vector3(0, 1, 0);
}
