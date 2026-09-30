// Dev: run the Stress fill and report render cost after a couple of frames.
export default async function run({ frame, page }) {
  const target = frame ?? page;
  return await target.evaluate(async () => {
    const s = window.stacker;
    s.onButton('stress');
    await new Promise((r) => setTimeout(r, 1500));
    const info = s.renderer.info.render;
    return { placed: s.placedTotal, draws: info.calls, tris: info.triangles };
  });
}
