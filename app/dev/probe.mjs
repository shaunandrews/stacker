// Dev probe: prints Stacker state as JSON (used by emulator tests).
export default async function run({ frame, page }) {
  const target = frame ?? page;
  return await target.evaluate(() => {
    const s = window.stacker;
    if (!s || !s.ready) return { error: 'not ready' };
    const round = (v) => Math.round(v * 1000) / 1000;
    const wp = (o) => o.getWorldPosition(o.position.clone()).toArray().map(round);
    const r = s.root.object3D;
    const recOut = (rec) => {
      const p = r.position.clone(); const q = r.quaternion.clone();
      s.placedWorldPose(rec, p, q);
      const e = rec.m.elements;
      // Quarter turns about up, and "free" = not upright or not on a quarter turn (placed by transform, not grid).
      const yaw = Math.atan2(-e[2], e[0]); const turns = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
      const free = Math.abs(e[5]) < 0.99 || Math.abs(yaw - Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2)) > 0.01;
      return { part: s.lib.parts[rec.part].id, turns, free, color: s.lib.colors[rec.color].code, local: [e[12], e[13], e[14]].map((v) => Math.round(v * 10000) / 10000), up: [e[4], e[5], e[6]].map((v) => Math.round(v * 100) / 100), w: p.toArray().map(round) };
    };
    return {
      placed: s.placedRecs.length, loose: s.loose.length, snaps: s.snaps.length, bounds: s.bounds, scale: s.scale,
      tool: s.tool, tab: s.tab, color: s.color, selection: s.selection.size,
      kit: s.kit ? { step: s.kit.step, steps: s.kit.steps.length, remaining: s.kit.remaining.length, shelf: s.shelfItems.length } : null,
      root: { p: r.position.toArray().map(round), q: r.quaternion.toArray().map(round) },
      hands: s.hands.map((h) => ({ mode: h.mode, target: h.target?.kind ?? null, far: h.targetFar, pieces: h.pieces?.length ?? 0, frame: h.frame, slider: !!h.slider })),
      previews: s.shelfPreviews().map((p) => p.map(round)),
      drum: { face: s.drum.frontFace(), angle: round(s.drum.angle), page: s.facePage[s.drum.frontFace()], bar: wp(s.drum.bar), caps: s.drum.caps.map(wp) },
      wrist: { open: s.wristOpen, visible: s.wrist.entity.object3D.visible },
      visual: s.visual, tone: s.tone, physical: s.physical, instructions: s.instructions, manual: !!s.manual, page: s.kit?.page ?? null,
      ui: Object.fromEntries(s.panels.flatMap((p) => p.items).map((u) => [u.id, wp(u.mesh)])),
      swatches: s.drum.jars.map((j) => wp(j.paint)),
      tiles: s.drum.tiles.map((t) => wp(t.brick)),
      guide: s.hands.map((h) => h.guide.visible), lit: s.hands.map((h) => !!h.lit),
      placedList: s.placedRecs.slice(0, 80).map(recOut),
      shelf: s.shelfItems.map((it) => ({ part: s.lib.parts[it.block.part].id, w: it.block.mesh.position.toArray().map(round) })),
      shelfBar: s.shelfBar ? wp(s.shelfBar) : null,
      kitTargets: s.kit ? s.kit.remaining.map(({ rec }) => recOut(rec)) : [],
    };
  });
}
