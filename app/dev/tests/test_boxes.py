"""Emulator regression test for kit boxes — run from app/: python3 dev/tests/test_boxes.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
R = 'controller-right'
def state(): return js('return { boxes: s.boxes.map(b => b.state), vis: s.boxes.map(b => b.mesh.visible), rack: s.rack.object3D.visible, held: s.hands[1].box && s.hands[1].box.kit.id, kit: s.kit && s.kit.id, shelf: s.shelfItems.length }')
def wpos(expr): return js(f'return {expr}.getWorldPosition(new s.v1.constructor()).toArray()')
def aim(target, back=(0.05, 0.1, 0.12)):
    move(R, [target[0] - back[0], target[1] + back[1], target[2] + back[2]], 0.2); look(R, target); time.sleep(0.25)

ensure_xr()
js('s.exitKit(); s.clearPlaced(); const h = 16; s.bounds = { x0: -h, x1: h, z0: -h, z1: h }; s.updatePlate(); s.recenter(); return 1')
time.sleep(0.5)
st = state()
ok('rack shows every kit box', st['rack'] and len(st['boxes']) == 7 and all(b == 'rack' for b in st['boxes']) and all(st['vis']), st)

# 1. Ray-grab a box off the rack: it comes to the hand.
k = js('return s.boxes.findIndex(b => b.kit.id === "31028-1")')
box = wpos(f's.boxes[{k}].mesh')
aim(box, (0.25, 0.1, 0.3))
btn(R, 0, 1); time.sleep(0.6)
st = state()
near = js(f'return s.boxes[{k}].mesh.position.distanceTo(s.hands[1].point)')
ok('grabbed box comes to the hand', st['held'] == '31028-1' and near < 0.2, round(near, 3))
btn(R, 0, 0); time.sleep(0.3)
ok('let go, it floats', state()['boxes'][k] == 'loose')

# 2. B on a floating box sends it home.
aim(wpos(f's.boxes[{k}].mesh'), (0.05, 0.05, 0.2))
btn(R, 4, 1); btn(R, 4, 0); time.sleep(0.6)
ok('B puts it back on the rack', state()['boxes'][k] == 'rack')

# 3. Take it again, let go, tear the strip: the kit starts where the box was.
aim(wpos(f's.boxes[{k}].mesh'), (0.25, 0.1, 0.3))
btn(R, 0, 1); time.sleep(0.5); btn(R, 0, 0); time.sleep(0.3)
boxAt = js(f'return s.boxes[{k}].mesh.position.toArray()')
tab = wpos(f's.boxes[{k}].tab')
aim(tab)
ok('tab is the target', js('return s.hands[1].target && s.hands[1].target.kind') == 'tear')
btn(R, 0, 1)
start = js('return s.hands[1].point.toArray()')
move(R, [start[0] + 0.05, start[1] + 0.02, start[2]], 0.15)
mid = js(f'return s.boxes[{k}].tear')
ok('pulling tears part way', 0.3 < mid < 1, round(mid, 2))
move(R, [start[0] + 0.12, start[1] + 0.04, start[2]], 0.15); time.sleep(0.8)
btn(R, 0, 0)
st = state()
shelf = js('return s.shelf && s.shelf.object3D.position.toArray()')
ok('torn open: kit started, rack away', st['kit'] == '31028-1' and not st['rack'] and st['shelf'] > 0, st)
ok('parts shelf sits where the box was', shelf and abs(shelf[0] - boxAt[0]) < 0.01 and abs(shelf[2] - boxAt[2]) < 0.01, (shelf, boxAt))

# 4. Leaving the kit brings the rack back with every box home.
js('s.exitKit(); return 1'); time.sleep(0.3)
st = state()
ok('exit kit: rack back, boxes home', st['rack'] and all(b == 'rack' for b in st['boxes']) and all(st['vis']), st)
