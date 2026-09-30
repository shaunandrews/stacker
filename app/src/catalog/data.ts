import { Library } from '../blocks.js';
import { KITS } from '../kits.js';
import type { KitFile } from '../kits.js';
import type { KitInfo } from '../kit-boxes.js';

// Everything the catalog shows, loaded once: the app's own parts library, every kit
// file, the audit review marks, and whether the dev server can save edits.

export type Mark = { s: 'ok' | 'flag'; note?: string };

export interface Review {
  parts: Record<string, Mark>;
  colors: Record<string, Mark>;
  kits: Record<string, { steps: Record<string, Mark> }>;
}

export interface Kit {
  info: KitInfo;
  file: KitFile;
}

export interface Catalog {
  lib: Library;
  kits: Kit[];
  review: Review;
  canEdit: boolean;
}

const BASE = import.meta.env.BASE_URL;

export async function loadCatalog(): Promise<Catalog> {
  const [lib, kits, review, canEdit] = await Promise.all([
    Library.load(BASE),
    Promise.all(KITS.map(async (info) => ({ info, file: await fetchKit(info.id) }))),
    fetch(`${BASE}catalog/review.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch('/__catalog/ping')
      .then((r) => r.ok && r.json())
      .then((d) => !!d?.edit)
      .catch(() => false),
  ]);
  return { lib, kits, review: { parts: {}, colors: {}, kits: {}, ...review }, canEdit };
}

export async function fetchKit(id: string): Promise<KitFile> {
  const r = await fetch(`${BASE}kits/${id}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`kits/${id}.json: ${r.status}`);
  return r.json();
}

export async function api<T = Record<string, unknown>>(route: string, body: unknown): Promise<T> {
  const r = await fetch(`/__catalog/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({ error: `${r.status}` }));
  if (!r.ok || d.error) throw new Error(d.error ?? `${r.status}`);
  return d;
}

/** A step's identity for review marks: its pieces. Editing a step clears its mark. */
export function stepKey(step: Array<{ k?: number }>): string {
  return step.map((b) => b.k ?? '?').join(',');
}
