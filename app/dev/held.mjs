export default async function run({ frame, page }) {
  return await (frame ?? page).evaluate(() => {
    const s = window.stacker;
    const h = s.hands[1];
    if (!h.pieces) return { held: null };
    const a = h.pieces[0];
    const ok = s.computeSnap(h.pieces);
    return { held: s.lib.parts[a.block.part].id, n: h.pieces.length, pos: a.block.mesh.position.toArray(), snap: ok ? s.snapOut.map((o) => ({ local: [o.m.elements[12], o.m.elements[13], o.m.elements[14]].map((v) => Math.round(v * 10000) / 10000), target: !!o.target })) : null };
  });
}
