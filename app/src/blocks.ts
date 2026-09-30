import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from '@iwsdk/core';

// ---- Units ----
// Parts come from the LDraw library (1 stud = 20 LDU, plate = 8 LDU, brick = 24 LDU).
// Geometry is built at real-brick size (8 mm stud pitch); the platform and loose
// blocks are scaled up or down as a whole by the Size slider.
export const dims = { pitch: 0.008, unit: 0.0016, ldu: 0.0004 };
// dims.unit is one height step: half a plate (4 LDU), so minifigs share the grid.

export const TABS = ['Bricks', 'Plates', 'Tiles', 'Slopes', 'Curves', 'Round', 'Wedges', 'Windows', 'Minifigs', 'More'];

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
      fetch(`${base}parts/parts.bin`).then((r) => r.arrayBuffer()),
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

  /** One material per palette color (held, loose and catalog blocks); see-through colors are transparent. */
  materials(physical: boolean): MeshStandardMaterial[] {
    return this.colors.map((c) => blockMaterial(physical, c.hex, c.alpha < 1));
  }

  linearColors(): Color[] {
    return this.colors.map((c) => new Color(c.hex));
  }
}

function align4(n: number): number {
  return n % 4 ? n + 4 - (n % 4) : n;
}

export function blockMaterial(physical: boolean, color: string | number, trans: boolean): MeshStandardMaterial {
  const opts = trans
    ? { color, roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false }
    : { color, roughness: 0.3, metalness: 0 };
  return withFixedColors(physical ? new MeshPhysicalMaterial(opts) : new MeshStandardMaterial(opts));
}

/**
 * Let per-vertex fixed colors override the main/instance color, so printed faces
 * and yellow hands survive recoloring. Attribute alpha 1 (or no attribute) = main color.
 */
export function withFixedColors<T extends MeshStandardMaterial>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 fixedColor;\nvarying vec4 vFixedColor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFixedColor = fixedColor;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFixedColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(vFixedColor.rgb, diffuseColor.rgb, vFixedColor.a);');
  };
  mat.customProgramCacheKey = () => 'stacker-fixed-color';
  return mat;
}

/** Baseplate stud, base at y = 0 (LDraw proportions: Ø 12 LDU, 4 LDU tall). */
export function studGeometry(): BufferGeometry {
  return new CylinderGeometry(6 * dims.ldu, 6 * dims.ldu, 4 * dims.ldu, 16).translate(0, 2 * dims.ldu, 0);
}
