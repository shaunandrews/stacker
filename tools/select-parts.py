"""Pick the most-used parts per category (by Rebrickable set inventories) that exist in LDraw.
Writes tools/selection.json. Run from data-src/."""
import csv, collections, os, json
parts = {r['part_num']: r for r in csv.DictReader(open('parts.csv'))}
cats = {r['id']: r['name'] for r in csv.DictReader(open('part_categories.csv'))}
qty = collections.Counter()
for r in csv.DictReader(open('inventory_parts.csv')):
    if r['is_spare'] != 'True':
        qty[r['part_num']] += int(r['quantity'])
# Rebrickable category -> Stacker catalog tab, and how many parts to take.
TABS = [
    ('Bricks', 'Bricks', 20), ('Plates', 'Plates', 20), ('Tiles', 'Tiles', 14),
    ('Bricks Sloped', 'Slopes', 20), ('Bricks Curved', 'Curves', 14),
    ('Bricks Round and Cones', 'Round', 12), ('Plates Round Curved and Dishes', 'Round', 10),
    ('Tiles Round and Curved', 'Tiles', 8), ('Bricks Wedged', 'Wedges', 10),
    ('Windows and Doors', 'Windows', 10),
]
SKIP = ('Glass', 'Sticker', 'Pattern', 'Print', 'Door Frame')
out = []
for cat, tab, n in TABS:
    picked = 0
    for p, q in qty.most_common():
        r = parts.get(p)
        if not r or cats.get(r['part_cat_id']) != cat: continue
        if any(s in r['name'] for s in SKIP): continue
        if not os.path.exists(f'ldraw/parts/{p}.dat'): continue
        out.append({'id': p, 'name': r['name'], 'tab': tab, 'uses': q})
        picked += 1
        if picked >= n: break
json.dump(out, open('../tools/selection.json', 'w'), indent=1)
print(len(out), 'parts selected')
