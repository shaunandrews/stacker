import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { dims } from './blocks.js';
import type { Library } from './blocks.js';
import type { KitInfo } from './kit-boxes.js';

// Kits: official models converted by tools/build-kit.py (docs/05-kits.md).

export const KITS: KitInfo[] = [
  { id: '7796-1', title: 'House', pieces: 56, color: '#c8102e' },
  { id: '6400-1', title: 'Go-Kart', pieces: 29, color: '#e8a000' },
  { id: '7910-1', title: 'Robot', pieces: 25, color: '#3a6fd8' },
  { id: '31028-1', title: 'Sea Plane', pieces: 53, color: '#0097a7' },
  { id: '6687-1', title: 'Turbo Prop', pieces: 90, color: '#1565c0' },
  { id: '6350-1', title: 'Pizza To Go', pieces: 166, color: '#2e7d32' },
  { id: '374-1', title: 'Fire Station', pieces: 363, color: '#b71c1c' },
];

/** One piece: on the lattice (i, j, level, turns) or free (`m`: rotation 9 + translation 3, LDU). */
export interface KitBlock {
  part: string;
  color: number; // LDraw color code
  k?: number; // index in the model file (stable across rebuilds)
  i?: number;
  j?: number;
  level?: number;
  turns?: number;
  fw?: number;
  fd?: number;
  m?: number[];
}

/** Where a step came from: authored in the model file, split bottom-up, or edited in the catalog. */
export type StepOrigin = 'file' | 'auto' | 'edit';

export interface KitFile {
  id: string;
  title: string;
  pieces: number;
  steps: KitBlock[][];
  origin?: StepOrigin[];
}

const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);

/** A kit block as part index, palette index and platform-local matrix, shifted by whole studs. */
export function kitPiece(lib: Library, b: KitBlock, di: number, dj: number): { part: number; color: number; m: Matrix4 } | null {
  const part = lib.byId.get(b.part);
  if (part === undefined) return null;
  const color = lib.colorIndex.get(b.color) ?? 0;
  if (b.m) {
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8, tx, ty, tz] = b.m;
    const L = dims.ldu;
    const m = new Matrix4().set(r0, r1, r2, tx * L + di * dims.pitch, r3, r4, r5, ty * L, r6, r7, r8, tz * L + dj * dims.pitch, 0, 0, 0, 1);
    return { part, color, m };
  }
  return { part, color, m: gridMatrix(lib, part, b.i! + di, b.j! + dj, b.level!, b.turns!) };
}

/** A part standing on the lattice: footprint corner at (i, j), `level` half plates up, turned by quarters. */
export function gridMatrix(lib: Library, part: number, i: number, j: number, level: number, turns: number): Matrix4 {
  const P = dims.pitch;
  const def = lib.parts[part];
  const [fw, fd] = turns % 2 === 0 ? [def.w, def.d] : [def.d, def.w];
  const center = new Vector3((i + fw / 2) * P, (level + def.h / 2) * dims.unit, (j + fd / 2) * P);
  return new Matrix4().compose(center, new Quaternion().setFromAxisAngle(UP, (turns * Math.PI) / 2), ONE);
}
