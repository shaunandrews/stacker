// Dev: replay mouse/keyboard steps from artifacts/mouse.json against the app page.
// Steps: ["move", x, y, steps?] ["down", button?] ["up", button?] ["key", key] ["keydown", key] ["keyup", key]
//        ["wheel", dy] ["wait", ms]
// Coordinates are in page pixels (the managed viewport is 800×800 unless configured).
import fs from 'node:fs';
export default async function run({ frame, page, workspaceRoot }) {
  // The headless managed window never takes keyboard focus, so keys are dispatched as
  // DOM events in the app frame. "Meta+Shift+z" style chords set the modifier flags.
  const target = frame ?? page;
  const press = (chord) =>
    target.evaluate((c) => {
      const parts = c.split('+');
      const key = parts.pop();
      const mods = new Set(parts.map((m) => m.toLowerCase()));
      const init = { key, bubbles: true, metaKey: mods.has('meta'), ctrlKey: mods.has('control'), shiftKey: mods.has('shift'), altKey: mods.has('alt') };
      window.dispatchEvent(new KeyboardEvent('keydown', init));
      window.dispatchEvent(new KeyboardEvent('keyup', init));
    }, chord);
  const steps = JSON.parse(fs.readFileSync(`${workspaceRoot}/artifacts/mouse.json`, 'utf8'));
  for (const [op, a, b, c] of steps) {
    if (op === 'move') await page.mouse.move(a, b, { steps: c ?? 8 });
    else if (op === 'down') await page.mouse.down({ button: a ?? 'left' });
    else if (op === 'up') await page.mouse.up({ button: a ?? 'left' });
    else if (op === 'key') await press(a);
    else if (op === 'keydown') await page.keyboard.down(a);
    else if (op === 'keyup') await page.keyboard.up(a);
    else if (op === 'wheel') await page.mouse.wheel(0, a);
    else if (op === 'wait') await page.waitForTimeout(a);
  }
  return { steps: steps.length };
}
