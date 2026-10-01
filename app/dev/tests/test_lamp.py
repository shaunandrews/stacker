"""Emulator regression test — run from app/: python3 dev/tests/test_lamp.py

The pull-cord lamp: pull the bead down past the click and the lights step down a level;
it springs back; pulling again steps on, and round to full.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
GRIP = 1
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def reset_ctrl(): cli('xr', 'set-transform', inp={'device': R, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
def bead(): return js('return s.lamp.bead.getWorldPosition(s.v1).toArray()')
def state(): return js('return { level: s.dimLevel, now: Math.round(s.dimNow * 100) / 100, key: Math.round(s.keyLight.intensity * 100) / 100, baseKey: s.visual.key, pull: Math.round(s.lamp.pull * 1000) / 1000 }')
def pull(dy):
    b = bead(); reset_ctrl(); tip_at(R, b); btn(R, GRIP, 1); time.sleep(0.15)
    move(R, [b[0], b[1] - dy, b[2] + 0.035], 0.35); time.sleep(0.2)
    st = state(); btn(R, GRIP, 0); time.sleep(0.8)
    return st

ensure_xr()
js('s.dimLevel = 0; s.dimNow = 1; s.applyVisuals(); s.lamp.setGlow(1); s.recenter(); return 1'); time.sleep(0.5)
s0 = state(); ok('starts at full light', s0['level'] == 0 and abs(s0['key'] - s0['baseKey']) < 0.01, s0)
mid = pull(0.03); s1 = state()
ok('a short pull stretches the cord but does not click', mid['pull'] > 0.02 and s1['level'] == 0, (mid, s1))
ok('the cord springs back', s1['pull'] < 0.002, s1)
mid = pull(0.09); s2 = state()
ok('a full pull clicks the lights down a level', s2['level'] == 1 and abs(s2['now'] - 0.6) < 0.02, s2)
ok('key light follows', abs(s2['key'] - s2['baseKey'] * 0.6) < 0.02, s2)
pull(0.09); s3 = state(); ok('again: low', s3['level'] == 2 and abs(s3['now'] - 0.3) < 0.02, s3)
pull(0.09); s4 = state(); ok('and round to full', s4['level'] == 0 and abs(s4['now'] - 1) < 0.02, s4)
