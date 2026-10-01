"""Emulator regression test — run from app/: python3 dev/tests/test_placement.py

Placement into empty spaces: a block held over (or in) a gap surrounded by blocks lands
in the gap, not on top of its neighbours; held over the neighbours, it still lands on them.
Calls computeSnap directly on a loose block at a chosen pose (no controller needed).
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)

BUILD = '''
const s0 = (part, i, j, level) => { const p = s.lib.byId.get(part); const d = s.lib.parts[p]; return { part, color: 4, i, j, level, turns: 0, fw: d.w, fd: d.d }; };
const steps = [STEPS];
s.exitKit(); s.clearPlaced(); s.setScale(1); s.recenter();
s.kitData.set("place-test", Promise.resolve(steps));
await s.startKit("place-test", "T");
const di = s.kit.di, dj = s.kit.dj;
for (let k = 0; k < 20 && s.kit; k++) s.skipStep();
s.exitKit();
return { n: s.placedRecs.length, di, dj };
'''
# Where a held part would land: hold it with its footprint corner over stud (i, j), its bottom `lift` meters above `level` half plates.
SNAP = '''
const part = s.lib.byId.get("PART"); const d = s.lib.parts[part];
const P = 0.008, U = 0.0016;
const local = new s.v1.constructor((I + d.w / 2) * P, (LEVEL + d.h / 2) * U + LIFT, (J + d.d / 2) * P);
const r = s.root.object3D; const world = r.localToWorld(local.clone());
const l = s.spawnLoose(part, 4, world, r.quaternion.clone());
const okSnap = s.computeSnap([{ block: l, offPos: new s.v1.constructor(), offQuat: new s.q1.constructor(), d2x: 0, d2z: 0, dl: 0 }]);
const m = okSnap ? s.snapOut[0].m.elements : null;
s.dropLoose(l, false);
if (!m) return null;
return { i: Math.round((m[12] / P - d.w / 2) * 100) / 100, j: Math.round((m[14] / P - d.d / 2) * 100) / 100, level: Math.round((m[13] / U - d.h / 2) * 100) / 100 };
'''
OFF = [0, 0]
def build(blocks):
    items = ', '.join(f's0("{p}", {i}, {j}, {lv})' for p, i, j, lv in blocks)
    r = js(BUILD.replace('[STEPS]', '[[' + items + ']]'))
    OFF[0], OFF[1] = r['di'], r['dj']
    return r['n']
def snap(part, i, j, level, lift):
    r = js(SNAP.replace('PART', part).replace('LEVEL', str(level)).replace('LIFT', str(lift)).replace('I +', f'{i + OFF[0]} +').replace('J +', f'{j + OFF[1]} +'))
    if r: r = {'i': round(r['i'] - OFF[0], 2), 'j': round(r['j'] - OFF[1], 2), 'level': r['level']}
    return r

ensure_xr()
# A ring of 1x1 bricks (one brick tall) around a 2x2 hole at studs (1..2, 1..2)
ring = [('3005', i, j, 0) for i in range(4) for j in range(4) if not (i in (1, 2) and j in (1, 2))]
n = build(ring); ok('ring of bricks built', n == 12, n)
r = snap('3003', 1, 1, 6, 0.002)   # 2x2 brick held just above the ring's top, over the hole
ok('held just above a hole: drops into it', r == {'i': 1, 'j': 1, 'level': 0}, r)
r = snap('3003', 1, 1, 0, 0.004)   # held down inside the hole
ok('held inside the hole: lands in it', r == {'i': 1, 'j': 1, 'level': 0}, r)
r = snap('3003', 1.3, 0.8, 6, 0.003)   # a little off-center over the hole
ok('slightly off-center over the hole: still drops in', r == {'i': 1, 'j': 1, 'level': 0}, r)
r = snap('3003', 0, 0, 6, 0.002)   # held over the ring's corner
ok('held over the neighbours: lands on top of them', r == {'i': 0, 'j': 0, 'level': 6}, r)
r = snap('3005', 0, 0, 6, 0.002)   # 1x1 on top of a ring brick
ok('1x1 over a ring brick: stacks on it', r == {'i': 0, 'j': 0, 'level': 6}, r)
# A floor of 1x1 plates with a 2x2 gap: a 2x2 plate fills it
floor = [('3024', i, j, 0) for i in range(4) for j in range(4) if not (i in (1, 2) and j in (1, 2))]
n = build(floor); ok('floor of plates built', n == 12, n)
r = snap('3022', 1, 1, 2, 0.002)
ok('2x2 plate over a gap in a floor: fills it', r == {'i': 1, 'j': 1, 'level': 0}, r)
# A deeper well: two bricks tall; a 2x2 plate held at the top settles to the bottom
well = ring + [('3005', i, j, 6) for i in range(4) for j in range(4) if not (i in (1, 2) and j in (1, 2))]
n = build(well); ok('two-tall well built', n == 24, n)
r = snap('3022', 1, 1, 12, 0.002)
ok('plate over a two-brick-deep well: settles to the bottom', r == {'i': 1, 'j': 1, 'level': 0}, r)
# Ceiling: a 4x4 plate over the ring sits on top, spanning the hole
n = build(ring)
r = snap('3031', 0, 0, 6, 0.002)
ok('4x4 plate over the ring: caps it', r == {'i': 0, 'j': 0, 'level': 6}, r)
# A 1-wide wall with a 1x2 slot: a brick hovering a centimeter above (and a little turned) drops into the slot
wall = [('3005', i, 0, 0) for i in range(6)] + [('3005', i, 0, 6) for i in range(6) if i not in (2, 3)]
n = build(wall); ok('wall with a slot built', n == 10, n)
r = snap('3004', 2, 0, 12, 0.012)
ok('hovering over a slot in a wall: drops in', r == {'i': 2, 'j': 0, 'level': 6}, r)
TURNED = SNAP.replace("r.quaternion.clone()", "r.quaternion.clone().multiply(new s.q1.constructor().setFromEuler(new s.euler.constructor(0.1, 0.2, 0)))")
r = js(TURNED.replace('PART', '3004').replace('LEVEL', '12').replace('LIFT', '0.012').replace('I +', f'{2 + OFF[0]} +').replace('J +', f'{0 + OFF[1]} +'))
r = r and {'i': round(r['i'] - OFF[0], 2), 'j': round(r['j'] - OFF[1], 2), 'level': r['level']}
ok('... even held a little crooked', r == {'i': 2, 'j': 0, 'level': 6}, r)
r = snap('3004', 0, 0, 12, 0.004)
ok('held over the wall top: stacks on it', r == {'i': 0, 'j': 0, 'level': 12}, r)
js('s.clearPlaced(); return 1')
