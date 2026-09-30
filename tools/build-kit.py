"""LDraw models (.mpd/.ldr) -> Stacker kits.

  python3 tools/build-kit.py collect data-src/*.mpd       # parts/colors the kits need -> tools/kit-parts.json
  python3 tools/build-kit.py build <model.mpd> <Title> <id> # -> app/public/kits/<id>.json

Sub-models are flattened. Upright, grid-aligned parts become lattice blocks
(i, j, level, turns); anything else (wheels, arms, hinged bits) is stored as a
free transform and snaps into place by its ghost. Authored STEPs are kept;
models without them are stepped bottom-up.

Every piece keeps `k`, its index in the model file, so step edits made in the
catalog (tools/kit-edits/<id>.json: {"steps": [[k, ...], ...]}) survive a rebuild.
`origin` says where each step came from: file (authored), auto (split bottom-up)
or edit (changed in the catalog).
"""
import csv, json, math, os, sys

UNIT = 4  # LDU per height step (half a plate)

def read_model(path):
    files, cur, order = {}, None, []
    for raw in open(path, encoding='latin1'):
        t = raw.split()
        if t[:2] == ['0', 'FILE']:
            cur = ' '.join(t[2:]).lower(); files[cur] = []; order.append(cur); continue
        if cur is None:
            cur = os.path.basename(path).lower(); files[cur] = []; order.append(cur)
        files[cur].append(t)
    return files, order[0]

def mul(A, B):  # 3x4 row-major
    r = [0.0] * 12
    for i in range(3):
        for j in range(4):
            v = A[i*4]*B[j] + A[i*4+1]*B[4+j] + A[i*4+2]*B[8+j]
            if j == 3: v += A[i*4+3]
            r[i*4+j] = v
    return r

def leaf_count(files, name):
    n = 0
    for t in files[name]:
        if t and t[0] == '1':
            ref = ' '.join(t[14:]).lower()
            n += leaf_count(files, ref) if ref in files else 1
    return n

def flatten(files, name, M, color, out, seq):
    """Parts of `name` in build order. seq[0] is the running step number: every STEP
    advances it, and a sub-model that's an assembly of its own (it has steps, or more
    than a few parts: a vehicle, a minifig) is built in its own steps, in the order the
    model lists it, before its parent carries on."""
    for t in files[name]:
        if not t: continue
        if t[:2] == ['0', 'STEP']: seq[0] += 1; continue
        if t[0] != '1': continue
        c = int(t[1]); c = color if c in (16, 24) else c
        n = list(map(float, t[2:14]))
        L = [n[3], n[4], n[5], n[0], n[6], n[7], n[8], n[1], n[9], n[10], n[11], n[2]]
        ref = ' '.join(t[14:]).lower()
        if ref in files:
            assembly = any(u[:2] == ['0', 'STEP'] for u in files[ref]) or leaf_count(files, ref) > 3
            if assembly: seq[0] += 1
            flatten(files, ref, mul(M, L), c, out, seq)
            if assembly: seq[0] += 1
        else:
            out.append({'part': ref.replace('\\', '/').replace('.dat', ''), 'color': c, 'M': mul(M, L), 'step': seq[0]})

# Parts printed with a brand logo swap for their plain version.
PLAIN = {'3596d21': '3596'}

def instances(path):
    files, main = read_model(path)
    out = []
    flatten(files, main, [1,0,0,0, 0,1,0,0, 0,0,1,0], 7, out, [0])
    for inst in out: inst['part'] = PLAIN.get(inst['part'], inst['part'])
    return out, len({inst['step'] for inst in out})

if sys.argv[1] == 'collect':
    names = {r['part_num']: r['name'] for r in csv.DictReader(open('data-src/parts.csv'))}
    have = {p['id'] for p in json.load(open('tools/selection.json'))} | {p['id'] for p in json.load(open('tools/minifigs.json'))['parts']}
    parts, colors = {}, set()
    for path in sys.argv[2:]:
        for inst in instances(path)[0]:
            colors.add(inst['color'])
            pid = inst['part']
            if pid not in have and pid not in parts:
                title = names.get(pid)
                if not title:
                    f = f'data-src/ldraw/parts/{pid}.dat'
                    title = open(f, encoding='latin1').readline()[2:].strip() if os.path.exists(f) else pid
                parts[pid] = {'id': pid, 'name': title, 'tab': 'More'}
    json.dump({'parts': list(parts.values()), 'colors': sorted(colors)}, open('tools/kit-parts.json', 'w'), indent=1)
    print(len(parts), 'extra parts,', len(colors), 'colors')
    sys.exit()

src, title, kit_id = sys.argv[2], sys.argv[3], sys.argv[4]
lib = {p['id']: p for p in json.load(open('app/public/parts/parts.json'))['parts']}
insts, nsteps = instances(src)
for k, inst in enumerate(insts): inst['k'] = k
blocks, missing = [], []
# Grid origin: models aren't always authored on a whole-stud grid, so use the most
# common stud offset among upright parts.
votes = {}
for inst in insts:
    p = lib.get(inst['part'])
    if not p: continue
    a, b, c, x, d, e, f, y, g, h, i, z = inst['M']
    if abs(e - 1) > 1e-3: continue
    cx, cy, cz = p['center']
    turns = round(math.atan2(-c, a) / (math.pi / 2)) % 4
    fw, fd = (p['w'], p['d']) if turns % 2 == 0 else (p['d'], p['w'])
    k = (round(((a*cx + b*cy + c*cz + x) / 20 - fw / 2) % 1, 2) % 1, round((-(g*cx + h*cy + i*cz + z) / 20 - fd / 2) % 1, 2) % 1)
    votes[k] = votes.get(k, 0) + 1
ox, oz = max(votes, key=votes.get) if votes else (0, 0)
for inst in insts:
    p = lib.get(inst['part'])
    if not p: missing.append(inst['part']); continue
    M = inst['M']; a, b, c, x, d, e, f, y, g, h, i, z = M
    cx, cy, cz = p['center']
    # Part center in model coords (LDraw, y down), then three.js axes (rotate 180° about X).
    wx = a*cx + b*cy + c*cz + x; wy = d*cx + e*cy + f*cz + y; wz = g*cx + h*cy + i*cz + z
    T = [wx, -wy, -wz]
    R = [a, -b, -c, -d, e, f, -g, h, i]
    blk = {'part': inst['part'], 'color': inst['color'], 'k': inst['k'], 'step': inst['step'], 'h': p['h'], 'T': T, 'R': R}
    # Lowest point of the part's box in model space, whatever its rotation.
    blk['low'] = T[1] - (abs(R[3]) * p['w'] * 10 + abs(R[4]) * p['h'] * UNIT / 2 + abs(R[5]) * p['d'] * 10)
    if abs(R[4] - 1) < 1e-3:
        turns = round(math.atan2(R[2], R[0]) / (math.pi / 2)) % 4
        fw, fd = (p['w'], p['d']) if turns % 2 == 0 else (p['d'], p['w'])
        ii, jj = T[0] / 20 - fw / 2 - ox, T[2] / 20 - fd / 2 - oz
        if abs(ii - round(ii)) < 0.05 and abs(jj - round(jj)) < 0.05:
            blk.update({'i': round(ii), 'j': round(jj), 'turns': turns, 'fw': fw, 'fd': fd})
    blocks.append(blk)
lat = [b for b in blocks if 'i' in b]
bots = [b['T'][1] - b['h'] * UNIT / 2 for b in (lat or blocks)]
res = {}
for v in bots: res[round(v % UNIT, 1) % UNIT] = res.get(round(v % UNIT, 1) % UNIT, 0) + 1
r0 = max(res, key=res.get)  # most parts sit on this half-plate phase
base = r0 + math.floor((min(b['low'] for b in blocks) - r0) / UNIT + 1e-3) * UNIT  # under every part, on that phase
for b in blocks:
    bottom = b['T'][1] - b['h'] * UNIT / 2 - base
    if 'i' in b:
        lvl = bottom / UNIT
        if abs(lvl - round(lvl)) < 0.05: b['level'] = round(lvl)
        else: [b.pop(k) for k in ('i', 'j', 'turns', 'fw', 'fd')]
    b['T'][1] -= base
    b['bottom'] = bottom
    if 'level' not in b:  # free part: keep the full transform (LDU, model space, three.js axes)
        b['m'] = [round(v, 5) for v in b['R']] + [round(v, 3) for v in b['T']]
    for k in ('R', 'T', 'h', 'low'): b.pop(k)
blocks.sort(key=lambda b: (b['step'], b['bottom']))

def layered(bs):
    """Bottom-up, 3–5 parts a step, small layers merged."""
    out, cur, lvl = [], [], None
    for b in bs:
        if cur and (len(cur) >= 5 or (b['bottom'] != lvl and len(cur) >= 3)):
            out.append(cur); cur = []
        cur.append(b); lvl = b['bottom']
    if cur: out.append(cur)
    return out

# Authored steps (and sub-models, in order) as they are; any step too big to follow
# at a glance — or a model with no steps at all — is broken up bottom-up.
groups = {}
for b in blocks: groups.setdefault(b['step'], []).append(b)
split, origin = [], []
for k in sorted(groups):
    g = groups[k]
    parts = [g] if len(g) <= 6 else layered(g)
    split += parts
    origin += ['file' if len(g) <= 6 else 'auto'] * len(parts)
# Step edits from the catalog replace the grouping; pieces they don't mention (the
# model changed) go in a last step so nothing is lost.
edits = f'tools/kit-edits/{kit_id}.json'
if os.path.exists(edits):
    by_k = {b['k']: b for b in blocks}
    seen, edited = set(), []
    for step in json.load(open(edits))['steps']:
        s = [by_k[k] for k in step if k in by_k and k not in seen]
        seen.update(b['k'] for b in s)
        if s: edited.append(s)
    rest = [b for b in blocks if b['k'] not in seen]
    if rest:
        edited.append(rest)
        print(f'{kit_id}: {len(rest)} pieces not in {edits}, added as a last step')
    # Steps the edits left alone keep saying where they came from.
    was = {tuple(sorted(b['k'] for b in g)): o for g, o in zip(split, origin)}
    split, origin = edited, [was.get(tuple(sorted(b['k'] for b in g)), 'edit') for g in edited]
for s in split:
    for b in s: b.pop('step'); b.pop('bottom')
json.dump({'id': kit_id, 'title': title, 'pieces': len(blocks), 'steps': split, 'origin': origin}, open(f'app/public/kits/{kit_id}.json', 'w'))
free = sum(1 for b in blocks if 'm' in b)
print(f'{kit_id}: {len(blocks)} parts ({free} free) in {len(split)} steps; missing {sorted(set(missing))}')
