// Dev: run window.stacker.<method>(...args) from STACKER_EVAL (JSON: [method, ...args]).
import fs from 'node:fs';
export default async function run({ frame, page, workspaceRoot }) {
  const target = frame ?? page;
  const [method, ...args] = JSON.parse(fs.readFileSync(`${workspaceRoot}/artifacts/eval.json`, 'utf8'));
  return await target.evaluate(async ([m, a]) => {
    const s = window.stacker;
    const out = await s[m](...a);
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, out: out ?? null, placed: s.placedRecs.length, draws: s.renderer.info.render.calls, tris: s.renderer.info.render.triangles };
  }, [method, args]);
}
