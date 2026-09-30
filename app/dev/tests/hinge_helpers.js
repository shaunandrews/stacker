// Emulator helpers (prepended to js() snippets): place parts through the real snap code.
const id = (x) => s.lib.byId.get(x);
const V = s.v1.constructor, Q = s.q1.constructor;
const place = (part, color, local, yawDeg = 0) => {
  const r = s.root.object3D;
  const pos = r.localToWorld(new V(...local));
  const q = r.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), (yawDeg * Math.PI) / 180));
  const block = s.spawnLoose(id(part), s.colorOf(color), pos, q, 0);
  const ok = s.computeSnap([{ block, offPos: new V(), offQuat: new Q() }]);
  let rec = null;
  if (ok) { rec = s.makeRec(id(part), s.colorOf(color), s.snapOut[0].m.clone(), undefined, 0); s.addPlaced(rec); }
  s.dropLoose(block, false);
  return rec;
};
const P = (rec) => new V().setFromMatrixPosition(rec.m).toArray().map((v) => +v.toFixed(4));
const W = (rec) => { const p = new V(), q = new Q(); s.placedWorldPose(rec, p, q); return p.toArray(); };
