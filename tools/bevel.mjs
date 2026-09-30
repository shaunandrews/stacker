// Chamfer the hard, convex edges of a part so they catch the light the way real
// moulded bricks do. LDraw geometry has perfectly sharp edges, which is a big part
// of why bricks read as flat and cheap.
//
// Input:  triangles (arrays of three [x, y, z] points, LDU) and one color per triangle.
// Output: triangles as three corners { p, n, c } with explicit normals:
//   - the original faces, inset away from each hard edge by `size`
//   - a strip across each hard edge whose normals blend from one face to the other,
//     so a single flat strip shades like a rounded edge
//   - small fills where several strips (or a strip and an untouched face) meet
//
// Smooth normals use the same crease-angle rule as before (35°).

const WELD = 20; // positions snap to 1/20 LDU when welding

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const pkey = (p) => `${Math.round(p[0] * WELD)},${Math.round(p[1] * WELD)},${Math.round(p[2] * WELD)}`;

export function bevel(faces, colors, { size = 0.5, crease = 35 } = {}) {
  const CREASE = Math.cos((crease * Math.PI) / 180);

  // ---- weld positions
  const verts = [];
  const ids = new Map();
  const vid = (p) => {
    const k = pkey(p);
    let i = ids.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push(p);
      ids.set(k, i);
    }
    return i;
  };
  let tris = [];
  faces.forEach((f, i) => {
    const v = f.map(vid);
    if (v[0] !== v[1] && v[1] !== v[2] && v[0] !== v[2]) tris.push({ v, c: colors[i] });
  });

  // ---- T-junctions: a vertex lying inside another triangle's edge splits that edge,
  // so edges on both sides of a crease line up one to one.
  const onEdge = (a, b) => {
    const A = verts[a];
    const d = sub(verts[b], A);
    const L2 = dot(d, d);
    const hits = [];
    for (let i = 0; i < verts.length; i++) {
      if (i === a || i === b) continue;
      const q = sub(verts[i], A);
      const t = dot(q, d) / L2;
      if (t <= 1e-4 || t >= 1 - 1e-4) continue;
      const off = sub(q, scale(d, t));
      if (dot(off, off) < 0.02 * 0.02) hits.push([t, i]);
    }
    return hits.sort((x, y) => x[0] - y[0]).map((h) => h[1]);
  };
  const split = [];
  for (const t of tris) {
    const loop = [];
    let extra = false;
    for (let k = 0; k < 3; k++) {
      loop.push(t.v[k]);
      const mid = onEdge(t.v[k], t.v[(k + 1) % 3]);
      if (mid.length) extra = true;
      loop.push(...mid);
    }
    if (!extra) {
      split.push(t);
      continue;
    }
    // Fan from the centroid: the loop is a triangle with extra points on its sides.
    const P = t.v.map((i) => verts[i]);
    const c = vid(scale(add(add(P[0], P[1]), P[2]), 1 / 3));
    for (let k = 0; k < loop.length; k++) split.push({ v: [c, loop[k], loop[(k + 1) % loop.length]], c: t.c });
  }
  tris = split;

  // ---- face normals, then crease-angle smooth normals per corner
  const fn = tris.map((t) => norm(cross(sub(verts[t.v[1]], verts[t.v[0]]), sub(verts[t.v[2]], verts[t.v[0]]))));
  const byVert = verts.map(() => []);
  tris.forEach((t, i) => t.v.forEach((v) => byVert[v].push(i)));
  const cornerNormal = (ti, v) => {
    const n0 = fn[ti];
    let n = [0, 0, 0];
    for (const j of byVert[v]) if (dot(fn[j], n0) >= CREASE) n = add(n, fn[j]);
    return norm(n);
  };
  // A group is one vertex as one surface sees it: position + smooth normal + color.
  const groups = new Map();
  const corners = tris.map((t, ti) =>
    t.v.map((v) => {
      const n = cornerNormal(ti, v);
      const k = `${v}|${n.map((x) => Math.round(x * 127))}|${t.c}`;
      let g = groups.get(k);
      if (!g) {
        g = { v, n, c: t.c, ws: [], p: verts[v] };
        groups.set(k, g);
      }
      return g;
    }),
  );

  // ---- hard convex edges: exactly two faces, opposite winding, folded past the crease
  const edges = new Map();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const a = t.v[k];
      const b = t.v[(k + 1) % 3];
      const ek = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edges.has(ek)) edges.set(ek, []);
      edges.get(ek).push({ ti, k, a, b });
    }
  });
  const hard = [];
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    const [A, B] = list;
    if (A.a !== B.b || A.b !== B.a) continue;
    if (dot(fn[A.ti], fn[B.ti]) >= CREASE) continue;
    const opposite = tris[B.ti].v[(B.k + 2) % 3];
    if (dot(fn[A.ti], sub(verts[opposite], verts[A.a])) > -1e-4) continue; // concave or flat
    hard.push([A, B]);
  }

  // ---- inset: each side of a hard edge moves into its own face
  const pushW = (g, w) => {
    if (!g.ws.some((x) => dot(x, w) > 0.995)) g.ws.push(w);
  };
  for (const pair of hard) {
    for (const e of pair) {
      const u = norm(sub(verts[e.b], verts[e.a]));
      const w = norm(cross(fn[e.ti], u)); // points into the face
      pushW(corners[e.ti][e.k], w);
      pushW(corners[e.ti][(e.k + 1) % 3], w);
    }
  }
  for (const g of groups.values()) {
    if (!g.ws.length) continue;
    let o;
    if (g.ws.length === 1) o = scale(g.ws[0], size);
    else {
      // Miter between the two most different inset directions.
      let best = [g.ws[0], g.ws[1]];
      let bd = dot(g.ws[0], g.ws[1]);
      for (let i = 0; i < g.ws.length; i++) {
        for (let j = i + 1; j < g.ws.length; j++) {
          const d = dot(g.ws[i], g.ws[j]);
          if (d < bd) {
            bd = d;
            best = [g.ws[i], g.ws[j]];
          }
        }
      }
      o = scale(add(best[0], best[1]), size / (1 + bd));
      const l = len(o);
      if (l > 3 * size) o = scale(o, (3 * size) / l);
    }
    g.p = add(verts[g.v], o);
  }

  // ---- output
  const out = [];
  const corner = (g) => ({ p: g.p, n: g.n, c: g.c });
  corners.forEach((cs) => out.push(cs.map(corner)));
  // Strips across hard edges: A's side runs b → a, B's side a → b.
  for (const [A, B] of hard) {
    const Aa = corners[A.ti][A.k];
    const Ab = corners[A.ti][(A.k + 1) % 3];
    const Bb = corners[B.ti][B.k];
    const Ba = corners[B.ti][(B.k + 1) % 3];
    out.push([corner(Ab), corner(Aa), corner(Ba)], [corner(Ab), corner(Ba), corner(Bb)]);
  }
  // Fills: wherever one vertex now sits in three or more places, close the gap.
  const atVert = new Map();
  for (const g of groups.values()) {
    if (!atVert.has(g.v)) atVert.set(g.v, []);
    atVert.get(g.v).push(g);
  }
  for (const gs of atVert.values()) {
    if (!gs.some((g) => g.ws.length)) continue;
    const pts = [];
    for (const g of gs) if (!pts.some((q) => len(sub(q.p, g.p)) < 0.02)) pts.push(g);
    if (pts.length < 3) continue;
    const N = norm(pts.reduce((s, g) => add(s, g.n), [0, 0, 0]));
    const C = scale(pts.reduce((s, g) => add(s, g.p), [0, 0, 0]), 1 / pts.length);
    const t1 = norm(Math.abs(N[0]) < 0.9 ? cross(N, [1, 0, 0]) : cross(N, [0, 1, 0]));
    const t2 = cross(N, t1);
    pts.sort((x, y) => {
      const dx = sub(x.p, C);
      const dy = sub(y.p, C);
      return Math.atan2(dot(dx, t2), dot(dx, t1)) - Math.atan2(dot(dy, t2), dot(dy, t1));
    });
    for (let k = 1; k + 1 < pts.length; k++) out.push([corner(pts[0]), corner(pts[k]), corner(pts[k + 1])]);
  }
  return { tris: out, stats: { input: faces.length, split: tris.length, hard: hard.length, out: out.length } };
}
