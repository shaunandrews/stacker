"""Find small official sets that our parts cover well and that exist in the LDraw OMR.

  cd data-src && python3 ../tools/find-kits.py [min_parts] [max_parts] [name-regex]

Prints sets (smallest first) whose inventory is >= 95% covered by tools/selection.json
and whose model is downloadable from https://library.ldraw.org/library/omr/<set>.mpd
"""
import csv, collections, json, re, subprocess, sys

lo = int(sys.argv[1]) if len(sys.argv) > 1 else 25
hi = int(sys.argv[2]) if len(sys.argv) > 2 else 150
pat = re.compile(sys.argv[3], re.I) if len(sys.argv) > 3 else None

sel = {p['id'] for p in json.load(open('../tools/selection.json'))}
sets = {r['set_num']: r for r in csv.DictReader(open('sets.csv'))}
inv = {r['id']: r['set_num'] for r in csv.DictReader(open('inventories.csv')) if r['version'] == '1' and r['set_num'] in sets}
tot, cov = collections.Counter(), collections.Counter()
for r in csv.DictReader(open('inventory_parts.csv')):
    s = inv.get(r['inventory_id'])
    if not s or r['is_spare'] == 'True':
        continue
    q = int(r['quantity'])
    tot[s] += q
    if r['part_num'] in sel:
        cov[s] += q
cands = [(cov[s] / t, t, s) for s, t in tot.items()
         if lo <= t <= hi and cov[s] / t >= 0.95 and (not pat or pat.search(sets[s]['name']))]
cands.sort(key=lambda c: (-c[0], c[1]))
found = 0
for c, t, s in cands[:500]:
    url = f'https://library.ldraw.org/library/omr/{s}.mpd'
    code = subprocess.run(['curl', '-sIL', '-o', '/dev/null', '-w', '%{http_code}', url], capture_output=True, text=True).stdout
    if code == '200':
        print(f"{s:10} {t:4} pcs  {c:.0%} covered  {sets[s]['year']}  {sets[s]['name']}")
        found += 1
        if found >= 15:
            break
