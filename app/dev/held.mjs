export default async function run({ frame, page }) {
  return await (frame ?? page).evaluate(() => {
    const s = window.stacker;
    const h = s.hands[1];
    if (!h.pieces) return { held: null };
    const a = h.pieces[0];
    const ok = s.computeSnap(h.pieces);
    return { held: s.lib.parts[a.block.part].id, n: h.pieces.length, pos: a.block.mesh.position.toArray(), snap: ok ? s.snapOut.map((o) => ({ i: o.i, j: o.j, level: o.level, turns: o.turns, free: !!o.m, target: !!o.target })) : null };
  });
}
