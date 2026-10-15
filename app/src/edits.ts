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
