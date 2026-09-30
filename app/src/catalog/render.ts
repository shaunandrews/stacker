import {
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Sphere,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from '@iwsdk/core';
import type { BufferGeometry, Material } from '@iwsdk/core';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { dims } from '../blocks.js';
import type { Library } from '../blocks.js';
import { ArtRenderer } from '../kit-boxes.js';
import type { ArtPiece } from '../kit-boxes.js';
import { kitPiece } from '../kits.js';
import type { KitBlock } from '../kits.js';
import { finishIndex, FINISHES, makeEnvScene, makeFinish } from '../look.js';
import type { Hold } from './audit.js';

// Pictures for the catalog: product-shot thumbnails (the box-art renderer) and an
// orbitable viewer, both with the app's real finishes.

export class Materials {
  private cache = new Map<string, Material>();
  private colors: Color[];
  constructor(private lib: Library) {
    this.colors = lib.linearColors();
  }
  /** Finish `finish` in palette color `color`; see-through colors render as clear, like the app. */
  get(color: number, finish = 0): Material {
    const f = this.lib.isTrans(color) && !FINISHES[finish].trans ? finishIndex('clear') : finish;
    const key = `${f}|${color}`;
    let m = this.cache.get(key);
    if (!m) this.cache.set(key, (m = makeFinish(FINISHES[f], this.colors[color])));
    return m;
  }
}

/** Renders thumbnails one at a time, off the main path, cached by key. */
export class Thumbnailer {
  private art: ArtRenderer | null = null;
  private cache = new Map<string, Promise<string>>();
  private queue: Array<() => Promise<void>> = [];
  private busy = false;

  constructor(private lib: Library, private mats: Materials) {}

  part(part: number, color: number, finish = 0, size = 256): Promise<string> {
    return this.get(`p:${part}:${color}:${finish}:${size}`, size, () => [{ geometry: this.lib.geometries[part], material: this.mats.get(color, finish), matrix: new Matrix4() }]);
  }

  kit(id: string, steps: KitBlock[][], size = 480): Promise<string> {
    return this.get(`k:${id}:${size}`, size, () => {
      const pieces: ArtPiece[] = [];
      for (const b of steps.flat()) {
        const p = kitPiece(this.lib, b, 0, 0);
        if (p) pieces.push({ geometry: this.lib.geometries[p.part], material: this.mats.get(p.color), matrix: p.m });
      }
      return pieces;
    });
  }

  forget(prefix: string): void {
    for (const k of [...this.cache.keys()]) if (k.startsWith(prefix)) this.cache.delete(k);
  }

  private get(key: string, size: number, pieces: () => ArtPiece[]): Promise<string> {
    let p = this.cache.get(key);
    if (!p) {
      p = new Promise<string>((resolve, reject) => {
        this.queue.push(async () => {
          try {
            this.art ??= new ArtRenderer();
            const src = this.art.render(pieces(), 'front');
            const c = document.createElement('canvas');
            c.width = c.height = size;
            c.getContext('2d')!.drawImage(src, 0, 0, size, size);
            const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
            resolve(blob ? URL.createObjectURL(blob) : c.toDataURL());
          } catch (err) {
            reject(err);
          }
        });
        void this.pump();
      });
      this.cache.set(key, p);
    }
    return p;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      await this.queue.shift()!();
      await new Promise((r) => setTimeout(r, 0)); // let input through between renders
    }
    this.busy = false;
  }
}

/** An <img> that asks for its picture once it scrolls into view. */
export function lazyImg(load: () => Promise<string>, alt = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.alt = alt;
  img.decoding = 'async';
  lazyObserver.observe(img);
  loaders.set(img, load);
  return img;
}
const loaders = new WeakMap<Element, () => Promise<string>>();
const lazyObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      lazyObserver.unobserve(e.target);
      loaders
        .get(e.target)?.()
        .then((src) => ((e.target as HTMLImageElement).src = src))
        .catch((err) => console.warn('thumbnail failed', err));
    }
  },
  { rootMargin: '300px' },
);

const HOLD_COLORS: Partial<Record<Hold, number>> = { floating: 0xef5b5b, touch: 0xf2b33d };

/** An orbitable 3D view in a canvas: one part (with its connectors) or a kit up to a step. */
export class Viewer {
  readonly canvas = document.createElement('canvas');
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.001, 20);
  private controls: OrbitControls;
  private content = new Group();
  private owned: Array<BufferGeometry | Material> = [];
  private edges = new Map<number, BufferGeometry>();
  private resize: ResizeObserver;
  private frame = 0;

  constructor(private lib: Library, private mats: Materials) {
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x000000, 0);
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(makeEnvScene('studio'), 0.04).texture;
    pmrem.dispose();
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 3, 2.2);
    this.scene.add(key, new HemisphereLight(0xffffff, 0x404040, 0.6), this.content);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.draw());
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(this.canvas);
  }

  showPart(part: number, color: number, finish = 0, connectors = true): void {
    this.reset();
    this.content.add(this.mesh(part, this.mats.get(color, finish), new Matrix4()));
    if (connectors) {
      const dot = new SphereGeometry(dims.ldu * 1.6, 12, 8);
      const stud = new MeshBasicMaterial({ color: 0x3fbf7f, depthTest: false, transparent: true, opacity: 0.9 });
      const sock = new MeshBasicMaterial({ color: 0xf28a3d, depthTest: false, transparent: true, opacity: 0.9 });
      this.owned.push(dot, stud, sock);
      for (const [type, x, y, z] of this.lib.parts[part].conn ?? []) {
        const m = new Mesh(dot, type === 0 ? stud : sock);
        m.position.set(x * dims.ldu, y * dims.ldu, z * dims.ldu);
        m.renderOrder = 10;
        this.content.add(m);
      }
    }
    this.frameContent(new Vector3(0.9, 0.75, 1.3));
  }

  /** The model through step n: earlier steps as built, this step outlined, trouble in red/amber. */
  showKit(steps: KitBlock[][], n: number, holds: Hold[] | null): void {
    const keep = this.content.children.length > 0;
    this.reset();
    const stepLine = new LineBasicMaterial({ color: 0x5b8def, depthTest: false, transparent: true, opacity: 0.9 });
    const holdLines = new Map<number, LineBasicMaterial>();
    this.owned.push(stepLine);
    steps.slice(0, n + 1).forEach((step, k) =>
      step.forEach((b, i) => {
        const p = kitPiece(this.lib, b, 0, 0);
        if (!p) return;
        this.content.add(this.mesh(p.part, this.mats.get(p.color), p.m));
        if (k !== n) return;
        const c = holds ? HOLD_COLORS[holds[i]] : undefined;
        let mat = stepLine;
        if (c !== undefined) {
          mat = holdLines.get(c) ?? new LineBasicMaterial({ color: c, depthTest: false, transparent: true });
          if (!holdLines.has(c)) this.owned.push(mat);
          holdLines.set(c, mat);
          // A see-through tint on top, so trouble shows from any side.
          const tint = new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, depthTest: false });
          this.owned.push(tint);
          const over = this.mesh(p.part, tint, p.m);
          over.renderOrder = 9;
          this.content.add(over);
        }
        const lines = new LineSegments(this.edgeGeo(p.part), mat);
        lines.matrixAutoUpdate = false;
        lines.matrix.copy(p.m);
        lines.renderOrder = 10;
        this.content.add(lines);
      }),
    );
    if (!keep) this.frameContent(new Vector3(0.85, 0.8, 1.2), steps.flat());
    else this.draw();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.reset();
    for (const g of this.edges.values()) g.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private mesh(part: number, material: Material, m: Matrix4): Mesh {
    const mesh = new Mesh(this.lib.geometries[part], material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    return mesh;
  }

  private edgeGeo(part: number): BufferGeometry {
    let g = this.edges.get(part);
    if (!g) this.edges.set(part, (g = new EdgesGeometry(this.lib.geometries[part], 30)));
    return g;
  }

  private reset(): void {
    this.content.clear();
    for (const o of this.owned) o.dispose();
    this.owned = [];
  }

  /** Aim at the content (or the whole kit, so the view holds still while stepping). */
  private frameContent(dir: Vector3, all?: KitBlock[]): void {
    let box = new Box3();
    if (all) {
      for (const b of all) {
        const p = kitPiece(this.lib, b, 0, 0);
        if (p) box.union(this.lib.geometries[p.part].boundingBox!.clone().applyMatrix4(p.m));
      }
    } else {
      this.content.updateMatrixWorld(true);
      box = new Box3().setFromObject(this.content);
    }
    const sphere = box.getBoundingSphere(new Sphere());
    const dist = (sphere.radius / Math.sin(((this.camera.fov / 2) * Math.PI) / 180)) * 1.05;
    this.camera.position.copy(sphere.center).addScaledVector(dir.normalize(), dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.update();
    this.draw();
  }

  private fit(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  private draw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      // Damping keeps moving after release: keep drawing while it settles.
      if (this.controls.update()) this.draw();
      this.renderer.render(this.scene, this.camera);
    });
  }
}
