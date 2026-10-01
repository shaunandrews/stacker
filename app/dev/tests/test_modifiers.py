"""Emulator regression test — run from app/: python3 dev/tests/test_modifiers.py

Controller modifiers: A/X + grip duplicates and frees the thumb for the stick;
B/Y + trigger selects (sweeping selects more); B/Y tapped alone deletes.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
TRIGGER, GRIP, A, B = 0, 1, 3, 4
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def reset_ctrl(): cli('xr', 'set-transform', inp={'device': R, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
def aim(p): move(R, [p[0] + 0.05, p[1] + 0.2, p[2] + 0.3], 0.3); look(R, p); time.sleep(0.2)
def hold_btn(): return js('return s.hands[1].holdButton')
def held_yaw(): return js('const q = s.hands[1].pieces[0].block.mesh.quaternion; return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))')

ensure_xr()
cli('xr', 'set-transform', inp={'device': 'headset', 'orientation': {'pitch': -40, 'yaw': 0, 'roll': 0}})
js('s.exitKit(); s.clearPlaced(); s.facePage[0] = 0; s.drum.angle = s.drum.target = 0; s.fillPartsShelf(); s.tool = "build"; s.selection.clear(); s.setScale(1); s.recenter(); return 1'); time.sleep(0.5)
s = probe(); root = s['root']['p']; top = root[1]
# Two blocks to work with
for dx in (-0.03, 0.03):
    reset_ctrl(); tip_at(R, s['previews'][0]); btn(R, GRIP, 1)
    tip_at(R, [root[0] + dx, top + 0.03, root[2]], 0.4); btn(R, GRIP, 0); time.sleep(0.4)
s = probe(); ok('two blocks placed', s['placed'] == 2, s['placed'])

# 1. A then grip: the copy is held by the grip; let go of A and keep it
b = s['placedList'][0]['w']
aim(b); btn(R, A, 1)
ok('A duplicates', probe()['hands'][1]['pieces'] == 1, hold_btn())
btn(R, GRIP, 1); time.sleep(0.15)
ok('grip takes over the hold', hold_btn() == 'squeeze', hold_btn())
btn(R, A, 0); time.sleep(0.2)
ok('letting go of A keeps the copy', probe()['hands'][1]['pieces'] == 1)
y0 = held_yaw(); stick(R, 1, 0); stick(R, 0, 0); time.sleep(0.4)
ok('thumbstick turns the copy', abs(held_yaw() - y0) > 0.5, (round(y0, 2), round(held_yaw(), 2)))
reset_ctrl(); move(R, [root[0], top + 0.03, root[2] + 0.06 + 0.035], 0.4); btn(R, GRIP, 0); time.sleep(0.4)
s = probe(); ok('releasing grip places it', s['placed'] == 3 and s['hands'][1]['pieces'] == 0, s['placed'])

# 2. A held first, then grip on a block: duplicate straight onto the grip
js('s.selection.clear(); return 1')
reset_ctrl(); move(R, [root[0] + 0.3, top + 0.2, root[2] + 0.3], 0.2); btn(R, A, 1)  # A on nothing
b = s['placedList'][1]['w']; aim(b); btn(R, GRIP, 1); time.sleep(0.15)
ok('A held + grip duplicates', probe()['hands'][1]['pieces'] == 1 and hold_btn() == 'squeeze', hold_btn())
btn(R, A, 0); btn(R, GRIP, 0); time.sleep(0.4)
s = probe()

# 3. B + trigger selects; sweeping onto another block adds it; no delete on release
js('s.selection.clear(); return 1')
p0, p1 = s['placedList'][0]['w'], s['placedList'][1]['w']; n0 = s['placed']
aim(p0); btn(R, B, 1); btn(R, TRIGGER, 1); time.sleep(0.15)
ok('B + trigger selects', probe()['selection'] == 1)
outline = js('return "#" + s.hands[1].outline.material.color.getHexString()')
ok('outline turns cyan while B is held', outline == '#22d3ee', outline)
look(R, p1); time.sleep(0.4)
ok('sweeping selects more', probe()['selection'] == 2, probe()['selection'])
btn(R, TRIGGER, 0); btn(R, B, 0); time.sleep(0.3)
s = probe(); ok('B used for selecting does not delete', s['placed'] == n0 and s['selection'] == 2, (s['placed'], s['selection']))
ok('still in Build tool', s['tool'] == 'build', s['tool'])

# 4. B + trigger on a selected block takes it out
aim(p0); btn(R, B, 1); btn(R, TRIGGER, 1); btn(R, TRIGGER, 0); btn(R, B, 0); time.sleep(0.3)
ok('B + trigger deselects', probe()['selection'] == 1)

# 5. B tapped alone deletes (on release)
js('s.selection.clear(); return 1')
s = probe(); n0 = s['placed']; aim(s['placedList'][-1]['w'])
btn(R, B, 1); time.sleep(0.15)
ok('B down alone does nothing yet', probe()['placed'] == n0)
btn(R, B, 0); time.sleep(0.3)
ok('B released alone deletes', probe()['placed'] == n0 - 1, (n0, probe()['placed']))
