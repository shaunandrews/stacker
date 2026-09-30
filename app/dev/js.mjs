// Dev: evaluate artifacts/js.txt in the page (with `s` = window.stacker) and return the result.
import fs from 'node:fs';
export default async function run({ frame, page, workspaceRoot }) {
  const code = fs.readFileSync(`${workspaceRoot}/artifacts/js.txt`, 'utf8');
  return await (frame ?? page).evaluate(async (c) => {
    const s = window.stacker;
    return await new Function('s', `return (async () => { ${c} })()`)(s);
  }, code);
}
