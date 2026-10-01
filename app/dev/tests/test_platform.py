"""Emulator regression test — run from app/: python3 dev/tests/test_platform.py

Platform handling: two hands on the platform move, turn and scale it; letting go of one
hands it back to the other.
"""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
L, R = 'controller-left', 'controller-right'
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def reset(dev): cli('xr', 'set-transform', inp={'device': dev, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
def yaw(q):
    x, y, z, w = q
    return math.degrees(math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x)))
def edges(): return js('return s.edges.map((e) => e.getWorldPosition(e.position.clone()).toArray())')

ensure_xr()
js('s.exitKit(); s.clearPlaced(); s.setScale(1); s.recenter(); return 1'); time.sleep(0.5)
e = edges()  # 0: +z (front), 1: -z (back), 2: +x (right), 3: -x (left)
s0 = probe()
reset(L); reset(R)
tip_at(L, e[3]); tip_at(R, e[2])
btn(L, 1, 1); btn(R, 1, 1); time.sleep(0.3)
s = probe(); ok('both hands hold the platform', s['hands'][0]['frame'] == 'platform' and s['hands'][1]['frame'] == 'platform', s['hands'])
# Spread the hands 1.5x apart: the platform scales up.
lx, rx = e[3][0], e[2][0]; mid = (lx + rx) / 2; half = (rx - lx) / 2
move(L, [mid - half * 1.5, e[3][1], e[3][2] + 0.035], 0.5); move(R, [mid + half * 1.5, e[2][1], e[2][2] + 0.035], 0.5); time.sleep(0.4)
s1 = probe(); ok('spreading scales it up', s1['scale'] > 1.35, (s0['scale'], s1['scale']))
# Swing the hands around each other (right hand back, left forward): it turns about up.
move(L, [mid - half * 1.2, e[3][1], e[3][2] + 0.035 + half * 0.8], 0.5); move(R, [mid + half * 1.2, e[2][1], e[2][2] + 0.035 - half * 0.8], 0.5); time.sleep(0.4)
s2 = probe(); dy = yaw(s2['root']['q']) - yaw(s0['root']['q'])
ok('turning the hands turns it about up', abs(dy) > 20, round(dy, 1))
up = js('const u = s.v1.set(0, 1, 0).applyQuaternion(s.root.object3D.quaternion); return [u.x, u.y, u.z]')
ok('it stays level', up[1] > 0.999, up)
# Let go with the left: the right carries on alone without a jump.
btn(L, 1, 0); time.sleep(0.3)
s3 = probe(); jump = math.dist(s3['root']['p'], s2['root']['p'])
ok('one hand lets go: the other keeps holding', s3['hands'][1]['frame'] == 'platform' and s3['hands'][0]['frame'] is None, s3['hands'])
ok('no jump when a hand lets go', jump < 0.01, round(jump, 4))
ok('scale settles on a slider step', abs(s3['scale'] * 20 - round(s3['scale'] * 20)) < 1e-6, s3['scale'])
r0 = s3['root']['p']
move(R, [mid + half * 1.2 + 0.1, e[2][1], e[2][2] + 0.035 - half * 0.8], 0.4); time.sleep(0.3)
s4 = probe(); ok('the remaining hand still moves it', s4['root']['p'][0] - r0[0] > 0.05, (r0, s4['root']['p']))
btn(R, 1, 0); time.sleep(0.3)
# Second hand joins anywhere on the plate.
js('s.setScale(1); s.recenter(); return 1'); time.sleep(0.5)
e = edges(); c = js('return s.plateCenter(s.v1).toArray()')
reset(L); reset(R)
tip_at(L, e[3]); btn(L, 1, 1); time.sleep(0.2)
tip_at(R, [c[0] + 0.05, c[1] + 0.01, c[2]]); btn(R, 1, 1); time.sleep(0.3)
s5 = probe(); ok('second hand can grab the plate itself', s5['hands'][1]['frame'] == 'platform', s5['hands'])
btn(L, 1, 0); btn(R, 1, 0); time.sleep(0.3)
s6 = probe(); ok('both let go', s6['hands'][0]['frame'] is None and s6['hands'][1]['frame'] is None)
# Alone, the plate surface is not a handle (no accidental moves while building).
tip_at(R, [c[0] + 0.05, c[1] + 0.01, c[2]]); time.sleep(0.2)
s7 = probe(); ok('plate alone is not a handle', s7['hands'][1]['target'] != 'edge', s7['hands'][1])
js('s.setScale(1); s.recenter(); return 1')
