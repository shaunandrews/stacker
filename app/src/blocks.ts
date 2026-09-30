import {
  BufferAttribute,
  BufferGeometry,
  Color,
} from '@iwsdk/core';
import { progress } from './splash.js';

// ---- Units ----
// Parts come from the LDraw library (1 stud = 20 LDU, plate = 8 LDU, brick = 24 LDU).
// Geometry is built at real-brick size (8 mm stud pitch); the platform and loose
// blocks are scaled up or down as a whole by the Size slider.
export const dims = { pitch: 0.008, unit: 0.0016, ldu: 0.0004 };
// dims.unit is one height step: half a plate (4 LDU), so minifigs share the grid.

export const TABS = ['Bricks', 'Plates', 'Tiles', 'Slopes', 'Curves', 'Round', 'Wedges', 'Windows', 'Special', 'Minifigs', 'More'];

export interface PartDef {
  id: string;
  name: string;
  tab: string;
  w: number; // studs along X
  d: number; // studs along Z
  h: number; // height in half plates
  center: [number, number, number]; // baked geometry center in the part's LDraw coordinates
  fixed: boolean; // has fixed-color regions (printed faces, yellow hands)
  overlap?: boolean; // hats and hair: no collision
  conn?: number[][]; // [type (0 stud, 1 socket), x, y, z, ax, ay, az] in LDU, baked frame
  joint?: { pair: string; role: 'base' | 'top'; o: [number, number, number] };
  offset: number;
  vertices: number;
  indices: number;
}

export interface ColorDef {
  code: number; // LDraw color code
  name: string;
  hex: string;
  alpha: number;
}

/** Parts whose rotation matters for kit matching (everything but plain rectangles and rounds). */
export function isSymmetric(def: PartDef): boolean {
  if (def.tab === 'Round') return !/Corner|Macaroni|Elbow|Rounded/.test(def.name);
  return (def.tab === 'Bricks' || def.tab === 'Plates' || def.tab === 'Tiles') && !/Corner|Curved|Half|Quarter/.test(def.name);
}

export interface MinifigPreset {
  name: string;
  legs: number; // LDraw color codes
  torso: number;
  hat: [string, number];
}

export interface MinifigData {
  presets: MinifigPreset[];
  assembly: Record<'legs' | 'torso' | 'head' | 'hat', [string | null, number]>;
}

export class Library {
  parts: PartDef[] = [];
  colors: ColorDef[] = [];
  byId = new Map<string, number>();
  colorIndex = new Map<number, number>();
  private data!: ArrayBuffer;
  geometries: BufferGeometry[] = [];
  minifigs!: MinifigData;

  static async load(base: string): Promise<Library> {
    const lib = new Library();
    const [meta, bin, colors, minifigs] = await Promise.all([
      fetch(`${base}parts/parts.json`).then((r) => r.json()),
      fetchWithProgress(`${base}parts/parts.bin`, (f) => progress(f * 0.9)),
      fetch(`${base}parts/colors.json`).then((r) => r.json()),
      fetch(`${base}parts/minifigs.json`).then((r) => r.json()),
    ]);
    lib.minifigs = minifigs;
    lib.parts = meta.parts;
    lib.data = bin;
    lib.colors = colors;
    lib.parts.forEach((p, i) => lib.byId.set(p.id, i));
    lib.colors.forEach((c, i) => lib.colorIndex.set(c.code, i));
    lib.buildGeometries();
    return lib;
  }

  /** (Re)build every part's geometry at the current scale. */
  buildGeometries(): void {
    for (const g of this.geometries) g.dispose();
    const s = dims.ldu / 10; // stored in 0.1 LDU
    this.geometries = this.parts.map((p) => {
      const pos = new Int16Array(this.data, p.offset, p.vertices * 3);
      const norOffset = p.offset + align4(p.vertices * 6);
      const nor = new Int8Array(this.data, norOffset, p.vertices * 4);
      const idx = new Uint16Array(this.data, norOffset + p.vertices * 4, p.indices);
      const P = new Float32Array(p.vertices * 3);
      const N = new Float32Array(p.vertices * 3);
      for (let v = 0; v < p.vertices; v++) {
        P[v * 3] = pos[v * 3] * s;
        P[v * 3 + 1] = pos[v * 3 + 1] * s;
        P[v * 3 + 2] = pos[v * 3 + 2] * s;
        N[v * 3] = nor[v * 4] / 127;
        N[v * 3 + 1] = nor[v * 4 + 1] / 127;
        N[v * 3 + 2] = nor[v * 4 + 2] / 127;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(P, 3));
      g.setAttribute('normal', new BufferAttribute(N, 3));
      g.setIndex(new BufferAttribute(idx.slice(), 1));
      if (p.fixed) {
        // Stored alpha is 255 where a color is fixed; the shader wants the opposite
        // (1 = use the main color) so geometry without the attribute — whose default
        // is (0, 0, 0, 1) — just uses the main color.
        const colOffset = norOffset + p.vertices * 4 + align4(p.indices * 2);
        const col = new Uint8Array(this.data.slice(colOffset, colOffset + p.vertices * 4));
        for (let k = 3; k < col.length; k += 4) col[k] = 255 - col[k];
        g.setAttribute('fixedColor', new BufferAttribute(col, 4, true));
      }
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    });
  }

  isTrans(color: number): boolean {
    return this.colors[color].alpha < 1;
  }

  linearColors(): Color[] {
    return this.colors.map((c) => new Color(c.hex));
  }
}

/** Fetch a binary, reporting 0–1 as it streams in (when the size is known). */
async function fetchWithProgress(url: string, onProgress: (fraction: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  // Content-Length is the transfer size; compressed responses stream more bytes, hence the cap.
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

function align4(n: number): number {
  return n % 4 ? n + 4 - (n % 4) : n;
}

/**
 * Baseplate stud, base at y = 0 (LDraw proportions: Ø 12 LDU, 4 LDU tall), with the
 * same rounded rim as the bevelled parts: a flat top, a rim whose normals turn from up
 * to outward, and a straight side. 80 triangles.
 */
export function studGeometry(): BufferGeometry {
  const L = dims.ldu;
  const SEG = 16;
  const pos: number[] = [0, 4 * L, 0];
  const nor: number[] = [0, 1, 0];
  // Rings: top edge of the rim (normal up), bottom of the rim and foot of the side (outward).
  const rings: Array<[number, number, boolean]> = [
    [5.5, 4, true],
    [6, 3.5, false],
    [6, 0, false],
  ];
  for (const [r, y, up] of rings) {
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(r * c * L, y * L, r * s * L);
      nor.push(up ? 0 : c, up ? 1 : 0, up ? 0 : s);
    }
  }
  const idx: number[] = [];
  const ring = (n: number, k: number) => 1 + n * SEG + (k % SEG);
  for (let k = 0; k < SEG; k++) {
    idx.push(0, ring(0, k + 1), ring(0, k));
    for (let n = 0; n < 2; n++) {
      idx.push(ring(n, k), ring(n, k + 1), ring(n + 1, k + 1), ring(n, k), ring(n + 1, k + 1), ring(n + 1, k));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}
