// Dev: tile artifacts/<prefix>-*.png into artifacts/<prefix>-sheet.png (labels from artifacts/sheet.json).
import fs from 'node:fs';
export default async function run({ page, workspaceRoot }) {
  const dir = `${workspaceRoot}/artifacts`;
  const { prefix, labels, cols = 4, tile = 420 } = JSON.parse(fs.readFileSync(`${dir}/sheet.json`, 'utf8'));
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.png') && !f.endsWith('sheet.png')).sort();
  const images = files.map((f) => `data:image/png;base64,${fs.readFileSync(`${dir}/${f}`).toString('base64')}`);
  const url = await page.evaluate(async ({ images, labels, cols, tile }) => {
    const rows = Math.ceil(images.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * tile;
    c.height = rows * tile;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < images.length; k++) {
      const img = new Image();
      img.src = images[k];
      await img.decode();
      const x = (k % cols) * tile;
      const y = Math.floor(k / cols) * tile;
      ctx.drawImage(img, x, y, tile, tile);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y + tile - 40, tile, 40);
      ctx.fillStyle = '#fff';
      ctx.font = '600 24px system-ui';
      ctx.fillText(labels[k] ?? '', x + 12, y + tile - 12);
    }
    return c.toDataURL('image/png');
  }, { images, labels, cols, tile });
  fs.writeFileSync(`${dir}/${prefix}-sheet.png`, Buffer.from(url.split(',')[1], 'base64'));
  return { tiles: images.length };
}
