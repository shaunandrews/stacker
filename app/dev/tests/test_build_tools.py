"""Emulator regression test — run from app/: python3 dev/tests/test_build_tools.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
def ok(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name, extra)
def ray_press(target, b=0):
    move(R, [target[0] + 0.05, target[1] + 0.05, target[2] + 0.3], 0.25); look(R, target); time.sleep(0.15)
    btn(R, b, 1); btn(R, b, 0)
def reset_ctrl():
    cli('xr','set-transform', inp={'device':R,'orientation':{'x':0,'y':0,'z':0,'w':1}})
cli('xr','set-transform', inp={'device':'headset','orientation':{'pitch':-40,'yaw':0,'roll':0}})
js('s.exitKit(); s.clearPlaced(); s.facePage[0] = 0; s.drum.angle = s.drum.target = 0; s.fillPartsShelf(); s.tool = "build"; s.selection.clear(); s.wristPinned = true; return 1'); time.sleep(0.5)
s = probe(); root = s['root']['p']; top = root[1]
# 1. catalog near grab → place
tip_at(R, s['previews'][0]); btn(R, 1, 1)
ok('catalog grab', probe()['hands'][1]['pieces'] == 1)
tip_at(R, [root[0], top + 0.03, root[2]], 0.4); btn(R, 1, 0); time.sleep(0.3)
s = probe(); ok('place', s['placed'] == 1, s['placedList'])
# 2. hold A to duplicate, release A to place
b = s['placedList'][0]['w']
move(R, [b[0] + 0.05, top + 0.2, b[2] + 0.3], 0.3); look(R, b); time.sleep(0.2)
btn(R, 3, 1)
ok('A-hold duplicates', probe()['hands'][1]['pieces'] == 1)
reset_ctrl(); move(R, [root[0] + 0.05, top + 0.03, root[2] + 0.045], 0.4)
btn(R, 3, 0); time.sleep(0.3)
s = probe(); ok('release A places copy', s['placed'] == 2 and s['hands'][1]['pieces'] == 0, s['placed'])
# 3. select two, then grab the group
ray_press(s['ui']['tool:select'])
for rec in s['placedList'][:2]: ray_press(rec['w'])
s = probe(); ok('select tool toggles', s['tool'] == 'select' and s['selection'] == 2, (s['tool'], s['selection']))
ray_press(s['ui']['tool:build'])
b = s['placedList'][0]['w']; reset_ctrl()
tip_at(R, b); btn(R, 1, 1)
ok('group grab', probe()['hands'][1]['pieces'] == 2)
tip_at(R, [root[0] - 0.06, top + 0.03, root[2] - 0.04], 0.4); btn(R, 1, 0); time.sleep(0.3)
s = probe(); ok('group placed, still selected', s['placed'] == 2 and s['selection'] == 2, s['placedList'])
# 4. A duplicates the whole selection
b = s['placedList'][0]['w']
move(R, [b[0] + 0.05, top + 0.2, b[2] + 0.3], 0.3); look(R, b); time.sleep(0.2)
btn(R, 3, 1); ok('A dup group', probe()['hands'][1]['pieces'] == 2)
reset_ctrl(); move(R, [root[0] + 0.07, top + 0.03, root[2] + 0.08], 0.4); btn(R, 3, 0); time.sleep(0.3)
s = probe(); ok('dup group placed', s['placed'] == 4, s['placed'])
# 5. recolor selection by tapping a swatch
ray_press(s['swatches'][17])  # blue
s = probe(); cols = sorted(set(p['color'] for p in s['placedList']))
ok('swatch recolors selection', s['color'] == 17 and 1 in cols, cols)
# 6. paint tool
ray_press(s['ui']['tool:paint']); ray_press(s['swatches'][14])  # lime? index 14
s = probe(); target = [p for p in s['placedList'] if p['color'] != 10][0] if any(p['color'] != 10 for p in s['placedList']) else s['placedList'][0]
ray_press(target['w'])
s = probe(); ok('paint', any(p['color'] == 10 for p in s['placedList']), [p['color'] for p in s['placedList']])
ray_press(s['ui']['tool:build'])
# 7. B deletes selection
s = probe(); sel = s['selection']; n0 = s['placed']
b = s['placedList'][0]['w']
move(R, [b[0] + 0.05, top + 0.2, b[2] + 0.3], 0.3); look(R, b); time.sleep(0.2); btn(R, 4, 1); btn(R, 4, 0); time.sleep(0.3)
s = probe(); ok('B deletes', s['placed'] < n0, (n0, s['placed'], sel))
# 8. save / clear / load
js('s.slot = 0; s.redrawUi(); return 1'); s = probe(); ray_press(s['ui']['slot:next']); ray_press(s['ui']['save'])
ok('wrist menu picks slot 2', js('return s.slot') == 1)
n1 = probe()['placed']; call('clearPlaced'); ray_press(s['ui']['load']); time.sleep(0.3)
s = probe(); ok('save + load slot 2', s['placed'] == n1 and n1 > 0, (n1, s['placed']))
