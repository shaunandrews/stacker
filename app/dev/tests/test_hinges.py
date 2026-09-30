"""Emulator regression test for hinged parts — run from app/: python3 dev/tests/test_hinges.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from hinge_setup import *
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)

# 1. Hinge 1x2 with a brick on it: grabbing the brick swings the hinge, stopping at 90°.
reset()
r = build_hinge()
ok('hinge base, top and brick snap together', all(r.values()), r)
ok('the brick swings with the hinge top', hjs('return (s.swingGroup(window.T.t) || []).length') == 2)
tgt, sw, ang = swing_local('k', [20, 45, 70, 95, 120], eye_off=(0.25, 0.02, 0.0), radius=0.02, hinge='t')
ok('grabbing the brick swings its hinge to the stop', sw == '3938' and ang in (90, -90), (tgt, sw, ang))

# 2. Window 1x4x3: panes and shutters seat on their mounts and swing open.
reset()
ok('frame, 2 panes, 2 shutters snap in', build_window() == 5)
_, sw1, a1 = swing_local('sr', [15, 35, 60, 85])
_, sw2, a2 = swing_local('sl', [-15, -35, -60, -85])
ok('shutters swing open', sw1 == sw2 == '3856' and abs(a1) > 60 and abs(a2) > 60, (a1, a2))
_, sw3, _ = swing_local('pr', [-15, -35], eye_off=(0.0, 0.1, 0.1))
ok('pane inside the frame can be grabbed and swung', sw3 == '3854', sw3)

# 3. Turntable turns past half a turn.
reset()
hjs('''const b = place("3680", 72, [0.02, 0.01, -0.04]); const t = place("3679", 7, [0.02, 0.02, -0.04]);
const k = place("3001", 14, [0.02, 0.03, -0.04]); window.T = { b, t, k }; return 1''')
_, sw4, a4 = swing_local('k', [30, 90, 150, 210, 270, 330, 390, 450], eye_off=(0, 0.15, 0.1), radius=0.015, hinge='t')
ok('turntable turns freely', sw4 == '3679' and abs(a4) > 180, a4)

# 4. A near grab pulled well off the arc takes the grabbed piece off instead.
k = hjs('return P(window.T.k)')
tip_at(R, L2W([k[0], k[1] + 0.006, k[2]]), 0.3); btn(R, 1, 1); time.sleep(0.2)
swinging = js('return !!s.hands[1].swing')
move(R, L2W([k[0], k[1] + 0.12, k[2] + 0.035]), 0.3); time.sleep(0.2)
held = js('return [!!s.hands[1].swing, s.hands[1].pieces && s.hands[1].pieces.length]')
btn(R, 1, 0); time.sleep(0.3)
ok('pulling off the arc detaches the grabbed piece', swinging and held == [False, 1], held)
