import { Box3, Matrix3, Vector3 } from '@iwsdk/core';
import { dims } from '../blocks.js';
import type { Library } from '../blocks.js';
import { kitPiece } from '../kits.js';
import type { KitBlock } from '../kits.js';
import type { Catalog, Kit } from './data.js';

// Checks over the parts, colors and kits. Everything here is computed in the browser
// from the same files the app loads.

export type Level = 'error' | 'warn' | 'info';

export interface Issue {
  level: Level;
  area: 'Parts' | 'Colors' | 'Kits';
  subject: string; // what it's about, for the list
  msg: string;
  href: string;
  key: string; // part id, color code or `kit:step`
}

/**
 * How a piece is held when its step is built: on the ground (the plate), on studs of
 * what's already there, only touching it (hinges, wheels on axles, clips), or by
 * nothing yet: it floats until a later step builds what it rests on.
 */
export type Hold = 'ground' | 'stud' | 'touch' | 'floating' | 'missing';

export interface KitAnalysis {
  holds: Hold[][]; // per step, per piece
  duplicates: Array<[number, number]>; // [step, index] of pieces sitting exactly on another
  missingParts: Set<string>;
  missingColors: Set<number>;
}

const LDU = dims.ldu;

export function analyzeKit(lib: Library, steps: KitBlock[][]): KitAnalysis {
  const flat: Array<{ step: number; idx: number; box: Box3 | null; b: KitBlock; key: string }> = [];
  const missingParts = new Set<string>();
  const missingColors = new Set<number>();
  // Connector hash: rounded LDU position → pieces with a stud or socket there.
  const conns = new Map<string, Array<{ p: number; type: number; dir: Vector3 }>>();
  const v = new Vector3();
  const n = new Matrix3();
  steps.forEach((step, s) =>
    step.forEach((b, idx) => {
      if (!lib.colorIndex.has(b.color)) missingColors.add(b.color);
      const piece = kitPiece(lib, b, 0, 0);
      const p = flat.length;
      if (!piece) {
        missingParts.add(b.part);
        flat.push({ step: s, idx, box: null, b, key: '' });
        return;
      }
      const box = lib.geometries[piece.part].boundingBox!.clone().applyMatrix4(piece.m);
      const e = piece.m.elements;
      flat.push({ step: s, idx, box, b, key: `${piece.part}|${b.color}|${e.map((x) => Math.round(x * 1e5) / 1e5 + 0).join(',')}` });
      n.setFromMatrix4(piece.m);
      for (const [type, x, y, z, ax, ay, az] of lib.parts[piece.part].conn ?? []) {
        v.set(x * LDU, y * LDU, z * LDU).applyMatrix4(piece.m);
        const k = `${Math.round(v.x / LDU)},${Math.round(v.y / LDU)},${Math.round(v.z / LDU)}`;
        let list = conns.get(k);
        if (!list) conns.set(k, (list = []));
        list.push({ p, type, dir: new Vector3(ax, ay, az).applyMatrix3(n).normalize() });
      }
    }),
  );

  // Links between pieces: studs into sockets (facing each other), or boxes overlapping.
  const studs = flat.map(() => new Set<number>());
  for (const list of conns.values()) {
    for (const a of list)
      for (const c of list) {
        if (a.p !== c.p && a.type === 0 && c.type === 1 && a.dir.dot(c.dir) < -0.9) {
          studs[a.p].add(c.p);
          studs[c.p].add(a.p);
        }
      }
  }
  // Boxes pulled in by 1 LDU so neighbours side by side don't count. Paper-thin parts
  // (stickers) instead reach out a little to meet the face they're stuck on.
  const thin = flat.map((f) => !!f.box && Math.min(...f.box.getSize(new Vector3()).toArray()) < 2 * LDU);
  const shrunk = flat.map((f, p) => (f.box ? f.box.clone().expandByScalar(thin[p] ? LDU / 2 : -LDU) : null));
  const meets = (a: number, c: number) =>
    thin[a] || thin[c] ? shrunk[thin[a] ? a : c]!.intersectsBox(flat[thin[a] ? c : a].box!) : !shrunk[a]!.isEmpty() && shrunk[a]!.intersectsBox(shrunk[c]!);
  const touch = flat.map(() => new Set<number>());
  for (let a = 0; a < flat.length; a++)
    for (let c = a + 1; c < flat.length; c++) {
      if (shrunk[a] && shrunk[c] && meets(a, c)) {
        touch[a].add(c);
        touch[c].add(a);
      }
    }
  let floor = Infinity;
  for (const f of flat) if (f.box) floor = Math.min(floor, f.box.min.y);

  const holds: Hold[][] = steps.map((s) => s.map(() => 'floating' as Hold));
  const built = new Set<number>();
  let at = 0;
  steps.forEach((step, s) => {
    const mine = step.map((_, i) => at + i);
    at += step.length;
    const held = new Set<number>();
    const settle = (withTouch: boolean) => {
      for (let changed = true; changed; ) {
        changed = false;
        for (const p of mine) {
          if (held.has(p)) continue;
          const f = flat[p];
          let hold: Hold | null = null;
          if (!f.box) hold = 'missing';
          else if (f.box.min.y <= floor + 8 * LDU) hold = 'ground';
          else if ([...studs[p]].some((q) => built.has(q) || held.has(q))) hold = 'stud';
          else if (withTouch && [...touch[p]].some((q) => built.has(q) || held.has(q))) hold = 'touch';
          if (hold) {
            holds[s][f.idx] = hold;
            held.add(p);
            changed = true;
          }
        }
      }
    };
    settle(false);
    settle(true);
    for (const p of mine) built.add(p);
  });

  const seen = new Map<string, number>();
  const duplicates: Array<[number, number]> = [];
  flat.forEach((f, p) => {
    if (!f.key) return;
    if (seen.has(f.key)) duplicates.push([f.step, f.idx]);
    else seen.set(f.key, p);
  });
  return { holds, duplicates, missingParts, missingColors };
}

/** Kit pieces using each part id and each color code. */
export function usage(cat: Catalog): { parts: Map<string, Map<string, number>>; colors: Map<number, Map<string, number>> } {
  const parts = new Map<string, Map<string, number>>();
  const colors = new Map<number, Map<string, number>>();
  const bump = <K>(m: Map<K, Map<string, number>>, k: K, kit: string) => {
    let per = m.get(k);
    if (!per) m.set(k, (per = new Map()));
    per.set(kit, (per.get(kit) ?? 0) + 1);
  };
  for (const kit of cat.kits)
    for (const b of kit.file.steps.flat()) {
      bump(parts, b.part, kit.info.id);
      bump(colors, b.color, kit.info.id);
    }
  return { parts, colors };
}

export function triangles(lib: Library, part: number): number {
  return lib.parts[part].indices / 3;
}

export function auditAll(cat: Catalog, analyses: Map<string, KitAnalysis>): Issue[] {
  const out: Issue[] = [];
  const { lib } = cat;
  const use = usage(cat);

  // ---- parts
  const names = new Map<string, string[]>();
  for (const p of lib.parts) names.set(p.name, [...(names.get(p.name) ?? []), p.id]);
  lib.parts.forEach((p, i) => {
    const add = (level: Level, msg: string) => out.push({ level, area: 'Parts', subject: p.name, msg, href: `#/parts/${encodeURIComponent(p.id)}`, key: p.id });
    if (!p.conn?.length && !p.joint && p.tab !== 'Minifigs') add('warn', 'No studs or sockets: it can’t snap to anything');
    if (p.tab === 'More' && !use.parts.has(p.id)) add('warn', 'In the More tab but no kit uses it');
    if ((names.get(p.name)?.length ?? 0) > 1) add('warn', `Same name as ${names.get(p.name)!.filter((id) => id !== p.id).join(', ')}`);
    if (/^[~_]|obsolete|moved to/i.test(p.name)) add('warn', 'LDraw placeholder name');
    const tris = triangles(lib, i);
    if (tris > 4000) add('info', `Heavy: ${tris.toLocaleString()} triangles`);
  });

  // ---- colors
  lib.colors.forEach((c) => {
    const add = (level: Level, msg: string) => out.push({ level, area: 'Colors', subject: c.name, msg, href: `#/colors/${c.code}`, key: String(c.code) });
    if (!use.colors.has(c.code)) add('info', 'No kit uses it (library only)');
  });
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  lib.colors.forEach((a, i) =>
    lib.colors.slice(i + 1).forEach((b) => {
      if (a.alpha !== b.alpha) return;
      const [p, q] = [rgb(a.hex), rgb(b.hex)];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < 24) out.push({ level: 'warn', area: 'Colors', subject: a.name, msg: `Almost the same as ${b.name} (Δ ${d.toFixed(0)})`, href: `#/colors/${a.code}`, key: String(a.code) });
    }),
  );

  // ---- kits
  for (const kit of cat.kits) {
    const a = analyses.get(kit.info.id)!;
    const add = (level: Level, msg: string, step?: number) =>
      out.push({
        level,
        area: 'Kits',
        subject: step === undefined ? kit.info.title : `${kit.info.title} · step ${step + 1}`,
        msg,
        href: `#/kits/${kit.info.id}${step === undefined ? '' : `/${step + 1}`}`,
        key: `${kit.info.id}:${step ?? ''}`,
      });
    for (const id of a.missingParts) add('error', `Uses part ${id}, which isn’t in the library`);
    for (const c of a.missingColors) add('error', `Uses color ${c}, which isn’t in the palette`);
    const pieces = kit.file.steps.flat().length;
    if (pieces !== kit.info.pieces) add('warn', `KITS says ${kit.info.pieces} pieces; the file has ${pieces}`);
    for (const [s, i] of a.duplicates) add('error', `${partName(lib, kit.file.steps[s][i].part)} sits exactly on top of an identical piece`, s);
    a.holds.forEach((hs, s) => {
      const floating = hs.map((h, i) => (h === 'floating' ? partName(lib, kit.file.steps[s][i].part) : null)).filter(Boolean) as string[];
      if (floating.length) add('warn', `${floating.length === 1 ? `${floating[0]} floats` : `${floating.length} pieces float (${[...new Set(floating)].join(', ')})`}: what holds ${floating.length === 1 ? 'it' : 'them'} comes later`, s);
    });
  }
  return out;
}

export function partName(lib: Library, id: string): string {
  const i = lib.byId.get(id);
  return i === undefined ? id : lib.parts[i].name;
}

export function analyzeAll(cat: Catalog): Map<string, KitAnalysis> {
  return new Map(cat.kits.map((k: Kit) => [k.info.id, analyzeKit(cat.lib, k.file.steps)]));
}

export const LEVEL_ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2 };

export function worst(issues: Issue[]): Level | null {
  let w: Level | null = null;
  for (const i of issues) if (!w || LEVEL_ORDER[i.level] < LEVEL_ORDER[w]) w = i.level;
  return w;
}
