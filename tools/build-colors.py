"""LDraw color table (LDConfig.ldr) -> app/public/parts/colors.json, for a curated palette."""
import json, re
PALETTE = [15, 71, 72, 0, 4, 320, 25, 191, 14, 226, 19, 28, 70, 2, 10, 27, 288, 1, 73, 322, 272, 85, 29, 26,
           47, 36, 46, 34, 43, 33]
table = {}
for line in open('data-src/ldraw/LDConfig.ldr', encoding='latin1'):
    m = re.match(r'0 !COLOUR (\S+)\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})\s+EDGE\s+\S+(.*)', line)
    if m:
        alpha = re.search(r'ALPHA\s+(\d+)', m.group(4))
        table[int(m.group(2))] = {'code': int(m.group(2)), 'name': m.group(1).replace('_', ' '),
                                  'hex': '#' + m.group(3).lower(), 'alpha': int(alpha.group(1)) / 255 if alpha else 1}
kit = json.load(open('tools/kit-parts.json'))['colors']
out = [table[c] for c in PALETTE + [k for k in kit if k not in PALETTE] if c in table]
json.dump(out, open('app/public/parts/colors.json', 'w'), indent=1)
print(len(out), 'colors;', [c['name'] for c in out])
