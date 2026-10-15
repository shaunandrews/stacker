// Edits: what changed in the build between two settled moments, keyed by stable block
// ids. One edit is both an undo step (each player undoes only their own) and the message
// another player applies to stay in sync (see StackerSystem "edits", docs/11).

/** A placed block, portable: part id | color code | finish id | 16 matrix values (platform-local meters). */
export type Spec = string;

export interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Edit {
  /** Per block: what it was (null: didn't exist) and what it is now (null: gone). */
  set: Array<[id: string, from: Spec | null, to: Spec | null]>;
  bounds?: [from: Bounds, to: Bounds];
}

export function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.x0 === b.x0 && a.x1 === b.x1 && a.z0 === b.z0 && a.z1 === b.z1;
}

/** The edit that takes state a to state b. */
export function diff(a: Map<string, Spec>, b: Map<string, Spec>, ba: Bounds, bb: Bounds): Edit {
  const set: Edit['set'] = [];
  for (const [id, spec] of a) {
    const now = b.get(id);
    if (now === undefined) set.push([id, spec, null]);
    else if (now !== spec) set.push([id, spec, now]);
  }
  for (const [id, spec] of b) if (!a.has(id)) set.push([id, null, spec]);
  const e: Edit = { set };
  if (!sameBounds(ba, bb)) e.bounds = [{ ...ba }, { ...bb }];
  return e;
}

export function isEmpty(e: Edit): boolean {
  return !e.set.length && !e.bounds;
}

/** Undo: the same edit, backwards. */
export function invert(e: Edit): Edit {
  return { set: e.set.map(([id, from, to]) => [id, to, from]), ...(e.bounds ? { bounds: [e.bounds[1], e.bounds[0]] as [Bounds, Bounds] } : {}) };
}

/** Apply an edit to a state map (the settled state, kept in step with what's applied). */
export function applyToMap(map: Map<string, Spec>, e: Edit): void {
  for (const [id, , to] of e.set) {
    if (to === null) map.delete(id);
    else map.set(id, to);
  }
}

/** Split an edit whose JSON is too big for one row into independent smaller ones. */
export function splitEdit(e: Edit, max = 50_000): Edit[] {
  if (JSON.stringify(e).length <= max) return [e];
  const out: Edit[] = [];
  let cur: Edit = e.bounds ? { set: [], bounds: e.bounds } : { set: [] };
  let size = 40;
  for (const entry of e.set) {
    const n = JSON.stringify(entry).length + 1;
    if (cur.set.length && size + n > max) {
      out.push(cur);
      cur = { set: [] };
      size = 40;
    }
    cur.set.push(entry);
    size += n;
  }
  if (cur.set.length || cur.bounds) out.push(cur);
  return out;
}

/** Several edits in a row as one (same result applied at once): for sending a burst together. */
export function mergeEdits(edits: Edit[]): Edit {
  const byId = new Map<string, [from: Spec | null, to: Spec | null]>();
  let bounds: [Bounds, Bounds] | undefined;
  for (const e of edits) {
    for (const [id, from, to] of e.set) {
      const cur = byId.get(id);
      if (cur) cur[1] = to;
      else byId.set(id, [from, to]);
    }
    if (e.bounds) bounds = bounds ? [bounds[0], e.bounds[1]] : [e.bounds[0], e.bounds[1]];
  }
  const out: Edit = { set: [...byId].filter(([, [from, to]]) => from !== to).map(([id, [from, to]]) => [id, from, to]) };
  if (bounds && !sameBounds(bounds[0], bounds[1])) out.bounds = bounds;
  return out;
}
