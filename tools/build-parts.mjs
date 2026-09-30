// Convert selected LDraw parts into one compact binary for the app.
//
//   node tools/build-parts.mjs
//
// Reads  data-src/ldraw/ (LDraw complete library) and tools/selection.json
// Writes app/public/parts/parts.json (metadata) + parts.bin (geometry)
//
// Each part is flattened (sub-files + primitives resolved, BFC winding honored),
// converted from LDraw axes (-Y up) to three.js axes, re-centered on its
// footprint, smoothed, welded and quantized. Geometry stays in LDraw units
// (1 stud = 20 LDU); the app scales it at runtime. Heights are counted in half
// plates (4 LDU) so minifigs stack on the same grid as bricks.

import fs from 'node:fs';
import path from 'node:path';
import { bevel } from './bevel.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LDRAW = path.join(ROOT, 'data-src/ldraw');
const OUT = path.join(ROOT, 'app/public/parts');
const selection = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/selection.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kit-parts.json'), 'utf8')).parts;
const minifig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/minifigs.json'), 'utf8'));
const special = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/special-parts.json'), 'utf8'));
const hinges = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/hinges.json'), 'utf8'));
const UNIT = 4; // LDU per height step (half a plate)
const BEVEL = 0.5; // LDU chamfer on hard convex edges (0.2 mm)
const SEAM = 0.3; // LDU each outer wall moves in (0.12 mm; a multiple of the 0.1 LDU storage grid, so both sides match)

// LDraw color table, for parts with fixed-color regions (printed faces, yellow hands).
const ldColors = new Map();
for (const line of fs.readFileSync(path.join(LDRAW, 'LDConfig.ldr'), 'latin1').split(/\r?\n/)) {
  const m = line.match(/CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})/);
  if (m) ldColors.set(Number(m[1]), m[2]);
}

// Studs you can attach to. Their transforms become connectors (position + direction).
const MALE = /^stud(2|2a|2s|2s2|2s2e|6a|10|15|17a)?\.dat$/;

// Underside detail nobody sees while building; dropping it roughly halves triangles.
const SKIP = [/^stud4/, /^stud3/, /^stud2a/, /^stud10/, /^stud12/, /^stud6/, /^stud16/];

// ---- file index (LDraw references are case-insensitive, with backslashes) ----
const index = new Map();
function walk(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    else index.set(rel.toLowerCase(), path.join(dir, entry.name));
  }
}
walk(path.join(LDRAW, 'parts'), '');
walk(path.join(LDRAW, 'p'), '');

const cache = new Map();
function load(name) {
  const key = name.replace(/\\/g, '/').toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const file = index.get(key);
  if (!file) {
    cache.set(key, null);
    return null;
  }
  const lines = [];
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/);
    const type = t[0];
    if (type === '0') {
      if (t[1] === 'BFC') lines.push({ type: 0, bfc: t.slice(2) });
    } else if (type === '1') {
      const n = t.slice(2, 14).map(Number);
      lines.push({ type: 1, color: Number(t[1]), m: [n[3], n[4], n[5], n[0], n[6], n[7], n[8], n[1], n[9], n[10], n[11], n[2]], file: t.slice(14).join(' ') });
    } else if (type === '3' || type === '4') {
      lines.push({ type: Number(type), color: Number(t[1]), p: t.slice(2, 2 + Number(type) * 3).map(Number) });
    }
  }
  cache.set(key, lines);
  return lines;
}

// 3×4 matrices, row-major: [a b c x; d e f y; g h i z]
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(A, B) {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      let v = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
      if (j === 3) v += A[i * 4 + 3];
      r[i * 4 + j] = v;
    }
  }
  return r;
}
const det = (M) =>
  M[0] * (M[5] * M[10] - M[6] * M[9]) - M[1] * (M[4] * M[10] - M[6] * M[8]) + M[2] * (M[4] * M[9] - M[5] * M[8]);
const apply = (M, x, y, z) => [
  M[0] * x + M[1] * y + M[2] * z + M[3],
  M[4] * x + M[5] * y + M[6] * z + M[7],
  M[8] * x + M[9] * y + M[10] * z + M[11],
];

// Parts with a field of studs (baseplates, big plates) use LDraw's 8-sided studs.
const MANY_STUDS = 64;
let lowStuds = false;

// color: 16 = the part's main color (tinted at runtime); anything else is fixed.
function flatten(name, M, invert, tris, color = 16, studs = null) {
  const lines = load(name);
  if (!lines) return false;
  let ccw = true;
  let certified = false;
  let invertNext = false;
  const flip0 = det(M) < 0;
  for (const L of lines) {
    if (L.type === 0) {
      for (const tok of L.bfc) {
        if (tok === 'CERTIFY') certified = true;
        else if (tok === 'NOCERTIFY') certified = false;
        else if (tok === 'CW') ccw = false;
        else if (tok === 'CCW') ccw = true;
        else if (tok === 'INVERTNEXT') invertNext = true;
      }
    } else if (L.type === 1) {
      const base = path.basename(L.file.replace(/\\/g, '/')).toLowerCase();
      const inv = invert !== invertNext;
      invertNext = false;
      const child = mul(M, L.m);
      if (studs && MALE.test(base)) {
        // Stud primitives sit on y = 0 and rise toward -y (LDraw is y-down).
        studs.push({ at: apply(child, 0, 0, 0), tip: apply(child, 0, -4, 0) });
      }
      if (SKIP.some((re) => re.test(base))) continue;
      const file = lowStuds && /^stud\d*[a-z]?\.dat$/.test(base) && index.has(`8/${base}`) ? `8/${base}` : L.file;
      flatten(file, child, inv, tris, L.color === 16 || L.color === 24 ? color : L.color, studs);
    } else {
      const p = L.p;
      const v = [];
      for (let k = 0; k < p.length; k += 3) v.push(apply(M, p[k], p[k + 1], p[k + 2]));
      const flip = !ccw !== (invert !== flip0);
      const faces = L.type === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
      const c = L.color === 16 || L.color === 24 ? color : L.color;
      for (const [a, b, cc] of faces) {
        const tri = flip ? [v[a], v[cc], v[b]] : [v[a], v[b], v[cc]];
        tri.color = c;
        tris.push(tri);
        if (!certified) {
          const back = flip ? [v[a], v[b], v[cc]] : [v[a], v[cc], v[b]]; // unknown winding → both sides
          back.color = c;
          tris.push(back);
        }
      }
    }
  }
  return true;
}

// ---- ambient occlusion ----
// Per-vertex occlusion from the part's own shape: short rays over the hemisphere around
// each vertex normal, hits weighted by closeness. Darkens stud bases, creases and hollows.
// Units are the packed ones (0.1 LDU).
const AO_REACH = 120; // 12 LDU: a stud is 4 tall, the pitch is 20
const AO_CELL = 60;
const AO_DIRS = (() => {
  // Cosine-weighted directions in a z-up frame (golden-angle spiral).
  const n = 24;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * 2.399963;
    out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - r * r)]);
  }
  return out;
})();

function bakeAO(pos, nor, idx) {
  const vcount = pos.length / 3;
  const tcount = idx.length / 3;
  const grid = new Map();
  const cellOf = (v) => Math.floor(v / AO_CELL);
  const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  for (let t = 0; t < tcount; t++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k] * 3;
      x0 = Math.min(x0, pos[v]); x1 = Math.max(x1, pos[v]);
      y0 = Math.min(y0, pos[v + 1]); y1 = Math.max(y1, pos[v + 1]);
      z0 = Math.min(z0, pos[v + 2]); z1 = Math.max(z1, pos[v + 2]);
    }
    for (let x = cellOf(x0); x <= cellOf(x1); x++)
      for (let y = cellOf(y0); y <= cellOf(y1); y++)
        for (let z = cellOf(z0); z <= cellOf(z1); z++) {
          const k = key(x, y, z);
          let cell = grid.get(k);
          if (!cell) grid.set(k, (cell = []));
          cell.push(t);
        }
  }
  const stamp = new Int32Array(tcount).fill(-1);
  let ray = 0;
  const out = new Int8Array(vcount);
  const e1 = [0, 0, 0], e2 = [0, 0, 0], pv = [0, 0, 0], tv = [0, 0, 0], qv = [0, 0, 0];
  for (let v = 0; v < vcount; v++) {
    const nx = nor[v * 3] / 127, ny = nor[v * 3 + 1] / 127, nz = nor[v * 3 + 2] / 127;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const n = [nx / nl, ny / nl, nz / nl];
    // Tangent frame around the normal.
    const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const tx = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
    const tl = Math.hypot(...tx);
    tx[0] /= tl; tx[1] /= tl; tx[2] /= tl;
    const by = [n[1] * tx[2] - n[2] * tx[1], n[2] * tx[0] - n[0] * tx[2], n[0] * tx[1] - n[1] * tx[0]];
    const o = [pos[v * 3] + n[0] * 2, pos[v * 3 + 1] + n[1] * 2, pos[v * 3 + 2] + n[2] * 2];
    let occ = 0;
    for (const [dx, dy, dz] of AO_DIRS) {
      const d = [tx[0] * dx + by[0] * dy + n[0] * dz, tx[1] * dx + by[1] * dy + n[1] * dz, tx[2] * dx + by[2] * dy + n[2] * dz];
      const ex = o[0] + d[0] * AO_REACH, ey = o[1] + d[1] * AO_REACH, ez = o[2] + d[2] * AO_REACH;
      ray++;
      let best = AO_REACH;
      for (let x = cellOf(Math.min(o[0], ex)); x <= cellOf(Math.max(o[0], ex)); x++)
        for (let y = cellOf(Math.min(o[1], ey)); y <= cellOf(Math.max(o[1], ey)); y++)
          for (let z = cellOf(Math.min(o[2], ez)); z <= cellOf(Math.max(o[2], ez)); z++) {
            const cell = grid.get(key(x, y, z));
            if (!cell) continue;
            for (const t of cell) {
              if (stamp[t] === ray) continue;
              stamp[t] = ray;
              // Möller–Trumbore
              const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
              for (let k = 0; k < 3; k++) { e1[k] = pos[i1 + k] - pos[i0 + k]; e2[k] = pos[i2 + k] - pos[i0 + k]; }
              pv[0] = d[1] * e2[2] - d[2] * e2[1]; pv[1] = d[2] * e2[0] - d[0] * e2[2]; pv[2] = d[0] * e2[1] - d[1] * e2[0];
              const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
              if (Math.abs(det) < 1e-9) continue;
              const inv = 1 / det;
              tv[0] = o[0] - pos[i0]; tv[1] = o[1] - pos[i0 + 1]; tv[2] = o[2] - pos[i0 + 2];
              const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
              if (u < 0 || u > 1) continue;
              qv[0] = tv[1] * e1[2] - tv[2] * e1[1]; qv[1] = tv[2] * e1[0] - tv[0] * e1[2]; qv[2] = tv[0] * e1[1] - tv[1] * e1[0];
              const w = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
              if (w < 0 || u + w > 1) continue;
              const hit = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
              if (hit > 0.5 && hit < best) best = hit;
            }
          }
      if (best < AO_REACH) occ += (1 - best / AO_REACH) ** 2;
    }
    out[v] = Math.round(Math.min(1, (occ / AO_DIRS.length) * 2.2) * 127);
  }
  return out;
}

// ---- build ----
const meta = [];
const chunks = [];
let offset = 0;
const seen = new Set();
const parts = [...special, ...selection, ...extra, ...minifig.parts].filter((p) => !seen.has(p.id) && seen.add(p.id));

for (const part of parts) {
  let tris = [];
  let studs = [];
  lowStuds = false;
  if (!flatten(`${part.id}.dat`, IDENTITY, false, tris, 16, studs) || tris.length === 0) {
    console.warn('skip (missing)', part.id);
    continue;
  }
  if (studs.length > MANY_STUDS) {
    lowStuds = true;
    tris = [];
    studs = [];
    flatten(`${part.id}.dat`, IDENTITY, false, tris, 16, studs);
  }
  // LDraw bounds (y down; the part's top surface is normally y = 0, studs above it).
  let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const [x, y, z] of t) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  // Footprint from the bounds, unless the part says otherwise (minifig arms and
  // hair overhang the stud they sit on).
  const w = part.w ?? Math.max(1, Math.round((x1 - x0) / 20));
  const d = part.d ?? Math.max(1, Math.round((z1 - z0) / 20));
  const top = part.top ?? (y0 < -4.5 ? Math.round(y0 / UNIT) * UNIT : 0); // studs stick 4 LDU above the top
  const h = part.h ?? Math.max(1, Math.round((y1 - top) / UNIT));
  const cx = part.w ? 0 : (x0 + x1) / 2;
  const cz = part.d ? 0 : (z0 + z1) / 2;
  const cy = top + (h * UNIT) / 2;

  // Convert to three axes (rotate 180° about X: y → -y, z → -z), centered on the footprint.
  const faces = tris.map((t) => t.map(([x, y, z]) => [x - cx, -(y - cy), -(z - cz)]));
  const fixed = tris.some((t) => t.color !== 16);
  const rgb = (code) => {
    const hex = ldColors.get(code) ?? 'ff00ff';
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
  };
  // Bevel hard edges (smooth normals come with it), then pull the outer walls in so
  // neighbouring bricks leave a hairline seam, like real ones (7.8 mm on an 8 mm pitch).
  const beveled = bevel(faces, tris.map((t) => t.color), { size: BEVEL });
  if (process.env.BEVEL_STATS?.split(',').includes(part.id)) console.log(part.id, beveled.stats);
  const seamX = part.w ? Infinity : w * 10;
  const seamZ = part.d ? Infinity : d * 10;
  const inset = (v, edge) => (Math.abs(Math.abs(v) - edge) < 0.05 ? v - Math.sign(v) * SEAM : v);
  const key = ([x, y, z]) => `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`;
  const verts = new Map();
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  for (const tri of beveled.tris) {
    for (const { p: q, n, c: code } of tri) {
      const p = [inset(q[0], seamX), q[1], inset(q[2], seamZ)];
      const c = code === 16 ? [0, 0, 0, 0] : rgb(code);
      const qn = [Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127)];
      const vk = `${key(p)}|${qn}|${c}`;
      let vi = verts.get(vk);
      if (vi === undefined) {
        vi = pos.length / 3;
        verts.set(vk, vi);
        pos.push(Math.round(p[0] * 10), Math.round(p[1] * 10), Math.round(p[2] * 10));
        nor.push(...qn);
        col.push(...c);
      }
      idx.push(vi);
    }
  }
  const vcount = pos.length / 3;
  if (vcount > 65535) {
    console.warn('skip (too big)', part.id, vcount);
    continue;
  }
  // Layout per part: Int16 positions (0.1 LDU), Int8 normals + baked AO in the 4th byte,
  // Uint16 indices.
  const posBuf = Buffer.from(new Int16Array(pos).buffer);
  const ao = bakeAO(pos, nor, idx);
  const norArr = new Int8Array(vcount * 4);
  for (let v = 0; v < vcount; v++) {
    norArr.set(nor.slice(v * 3, v * 3 + 3), v * 4);
    norArr[v * 4 + 3] = ao[v];
  }
  const norBuf = Buffer.from(norArr.buffer);
  const idxBuf = Buffer.from(new Uint16Array(idx).buffer);
  const pad = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
  // Fixed-color parts carry RGBA8 per vertex (alpha 0 = use the main color).
  const colBuf = fixed ? Buffer.from(new Uint8Array(col).buffer) : Buffer.alloc(0);
  const blob = Buffer.concat([pad(posBuf), norBuf, pad(idxBuf), colBuf]);
  chunks.push(blob);
  // Connectors, in the baked (centered, three.js-axes) frame, LDU:
  // [type, x, y, z, ax, ay, az] — type 0 = stud (male), 1 = socket (female).
  const conn = [];
  const r1 = (v) => Math.round(v * 10) / 10;
  for (const { at, tip } of studs) {
    const ax = tip[0] - at[0];
    const ay = tip[1] - at[1];
    const az = tip[2] - at[2];
    const l = Math.hypot(ax, ay, az) || 1;
    conn.push([0, r1(at[0] - cx), r1(-(at[1] - cy)), r1(-(at[2] - cz)), r1(ax / l), r1(-ay / l), r1(-az / l)]);
  }
  // Sockets: a stud-grid under the footprint. Minifig parts only get them on the legs.
  if ((part.tab !== 'Minifigs' || part.id === '3815c01') && part.joint?.role !== 'top') {
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        conn.push([1, r1((i - (w - 1) / 2) * 20), r1(-(h * UNIT) / 2), r1((j - (d - 1) / 2) * 20), 0, -1, 0]);
      }
    }
  }

  meta.push({
    id: part.id,
    name: part.name,
    tab: part.tab,
    w, d, h,
    // Where the baked geometry's center sits in the part's own LDraw coordinates.
    center: [cx, cy, cz],
    fixed,
    conn,
    // Paired parts (hinge top/base, turntable top/base) share their LDraw origin when
    // assembled; record where that origin sits in the baked frame.
    ...(part.joint ? { joint: { ...part.joint, o: [r1(-cx), r1(cy), r1(cz)] } } : {}),
    // Parts that swing once placed: pivot and axis in the baked frame (LDU), range in degrees.
    ...(hinges[part.id]
      ? (({ pivot: [px, py, pz], axis: [ax, ay, az], range }) => ({
          hinge: { p: [r1(px - cx), r1(cy - py), r1(cz - pz)], a: [ax, -ay || 0, -az || 0], r: range },
        }))(hinges[part.id])
      : {}),
    ...(part.overlap ? { overlap: true } : {}),
    offset,
    vertices: vcount,
    indices: idx.length,
  });
  offset += blob.length;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'parts.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'parts.json'), JSON.stringify({ unit: 'LDU', parts: meta }));
const tri = meta.reduce((s, m) => s + m.indices / 3, 0);
console.log(`${meta.length} parts, ${(offset / 1024).toFixed(0)} KB, avg ${Math.round(tri / meta.length)} tris`);
for (const m of meta) if (m.indices / 3 > 3000) console.log('  heavy', m.id, m.name, m.indices / 3);
