"""Emulator regression test — run from app/: python3 dev/tests/test_turning.py

Thumbstick turns: the first flick squares the held block to the platform's axes (and the
wrist stops turning it); spins and tips land on whole quarter turns; guides show.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
GRIP = 1
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def orient(dev, yaw=0, pitch=0, roll=0): cli('xr', 'set-transform', inp={'device': dev, 'orientation': {'yaw': yaw, 'pitch': pitch, 'roll': roll}})
# The held block's rotation in the platform's frame, as a 3x3 (rows), rounded.
LOCAL = 'const m = new s.m1.constructor().makeRotationFromQuaternion(s.q2.copy(s.root.object3D.quaternion).invert().multiply(s.hands[1].pieces[0].block.mesh.quaternion)).elements; return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]].map((v) => Math.round(v * 1000) / 1000)'
def square(m): return all(min(abs(v), abs(abs(v) - 1)) < 0.02 for v in m)
def up_axis(m): return [m[1], m[4], m[7]]  # the block's local Y in platform coordinates

ensure_xr()
cli('xr', 'set-transform', inp={'device': 'headset', 'orientation': {'pitch': -40, 'yaw': 0, 'roll': 0}})
js('s.exitKit(); s.clearPlaced(); s.facePage[0] = 0; s.drum.angle = s.drum.target = 0; s.fillPartsShelf(); s.tool = "build"; s.selection.clear(); s.setScale(1); s.recenter(); return 1'); time.sleep(0.5)
s = probe(); root = s['root']['p']; top = root[1]
# Grab from the library with a twisted wrist, so the block starts off-axis
cli('xr', 'set-transform', inp={'device': R, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
move(R, [s['previews'][0][0], s['previews'][0][1], s['previews'][0][2] + 0.035], 0.3)
btn(R, GRIP, 1); time.sleep(0.2)
orient(R, yaw=25, pitch=10, roll=20); time.sleep(0.4)
m0 = js(LOCAL); ok('held block starts off-axis (follows the wrist)', not square(m0), m0)
stick(R, 1, 0); stick(R, 0, 0); time.sleep(0.5)
m1 = js(LOCAL); ok('first flick squares it to the platform', square(m1), m1)
ok('axis guide shows', js('return s.hands[1].axes.visible'))
# The ring is brief: turn and look within one call (then turn back)
ring = js('const h = s.hands[1]; s.turnAligned(h, "spin", 1); await new Promise((r) => setTimeout(r, 120)); const v = h.turnRing.visible; s.turnAligned(h, "spin", -1); return v')
ok('turn ring shows', ring)
time.sleep(0.5)
orient(R, yaw=-30, pitch=-20, roll=-25); time.sleep(0.4)
m2 = js(LOCAL); ok('wrist no longer turns it', m2 == m1, (m1, m2))
stick(R, -1, 0); stick(R, 0, 0); time.sleep(0.5)
m3 = js(LOCAL); ok('spin is a quarter turn about up', square(m3) and m3 != m1 and up_axis(m3) == up_axis(m1), (m1, m3))
# Tip with the controller's side along the platform's X: the block's up swings toward Z
orient(R, yaw=0); time.sleep(0.2)
stick(R, 0, -1); stick(R, 0, 0); time.sleep(0.5)
m4 = js(LOCAL); u = up_axis(m4)
ok('tip turns it about the platform X axis', square(m4) and abs(u[1]) < 0.02 and abs(abs(u[2]) - 1) < 0.02, u)
# Controller turned 90° (side now along Z): the tip goes about Z instead
stick(R, 0, 1); stick(R, 0, 0); time.sleep(0.4)  # undo the tip
orient(R, yaw=90); time.sleep(0.2)
stick(R, 0, -1); stick(R, 0, 0); time.sleep(0.5)
u = up_axis(js(LOCAL)); ok('tip follows the controller side (Z when turned 90°)', abs(abs(u[0]) - 1) < 0.02 and abs(u[1]) < 0.02, u)
stick(R, 0, 1); stick(R, 0, 0); time.sleep(0.4)
# Place it: the landing keeps the orientation shown
cli('xr', 'set-transform', inp={'device': R, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
m5 = js(LOCAL)
move(R, [root[0], top + 0.03, root[2] + 0.035], 0.4); time.sleep(0.3)
btn(R, GRIP, 0); time.sleep(0.5)
s = probe(); ok('placed', s['placed'] == 1, s['placed'])
ok('guides hide after letting go', not js('return s.hands[1].axes.visible || s.hands[1].turnRing.visible'))
