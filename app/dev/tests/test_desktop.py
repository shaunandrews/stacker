"""Emulator regression test for the desktop (mouse + keyboard) view — run from app/: python3 dev/tests/test_desktop.py"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
PROJ = 'const px = (v) => { const p = v.clone().project(s.camera); return [Math.round((p.x+1)/2*800), Math.round((1-p.y)/2*800)]; };'
def px(expr): return js(PROJ + f'return px({expr});')
def placed_px(k): return px(f'(()=>{{const p=new s.v1.constructor(), q=new s.q1.constructor(); s.placedWorldPose(s.placedRecs[{k}],p,q); return p;}})()')
def mouse(steps):
    json.dump(steps, open(ARTIFACTS + '/mouse.json', 'w'))
    return cli('browser', 'run', 'dev/mouse.mjs')
def state(): return js('return { placed: s.placedRecs.length, undo: s.undoStack.length, redo: s.redoStack.length, sel: s.selection.size, held: !!s.hands[1].pieces }')

cli('browser', 'reload'); time.sleep(6)
ok('splash offers both ways in', js('return !document.getElementById("splash").classList.contains("hidden") && document.getElementById("splash").classList.contains("ready")'))
js('document.getElementById("enter-desktop").click(); return 1'); time.sleep(1)
ok('desktop mode on, splash hidden', js('return s.desktop.enabled && document.getElementById("splash").classList.contains("hidden")'))
js('const r = s.root.object3D; s.placeDefault(r.position.clone(), s.yawOf(r.quaternion)); s.frameCamera(); s.exitKit(); s.clearPlaced(); s.facePage[0] = 0; s.drum.angle = s.drum.target = 0; s.fillPartsShelf(); return 1')
time.sleep(0.5)

# 1. drag a part from the shelf onto the plate
cells = js(PROJ + 'return s.shelfPreviews().map((p) => px(new s.v1.constructor(...p)))')
cell = [c for c in cells if 0 < c[0] < 800 and 0 < c[1] < 800][0]
plate = px('s.plateCenter(new s.v1.constructor())')
mouse([['move', cell[0], cell[1]], ['wait', 150], ['down'], ['move', plate[0], plate[1], 20], ['wait', 250]])
ok('dragging a catalog part carries it', state()['held'])
mouse([['up'], ['wait', 400]])
s0 = state(); ok('release places it', s0['placed'] == 1 and not s0['held'], s0)

# 2. Alt-drag duplicates
b = placed_px(0); to = px('s.plateCenter(new s.v1.constructor()).add(new s.v1.constructor(0.04, 0, 0.03))')
mouse([['move', b[0], b[1]], ['wait', 150], ['keydown', 'Alt'], ['down'], ['keyup', 'Alt'], ['move', to[0], to[1], 15], ['wait', 250], ['up'], ['wait', 400]])
s1 = state(); ok('Alt-drag duplicates', s1['placed'] == 2, s1)

# 3. undo / redo
mouse([['key', 'Meta+z'], ['wait', 200]]); s2 = state(); ok('undo', s2['placed'] == 1 and s2['redo'] == 1, s2)
mouse([['key', 'Meta+Shift+z'], ['wait', 200]]); s3 = state(); ok('redo', s3['placed'] == 2 and s3['redo'] == 0, s3)

# 4. Shift-click selects, Delete removes
b = placed_px(1)
mouse([['move', b[0], b[1]], ['wait', 150], ['keydown', 'Shift'], ['down'], ['up'], ['keyup', 'Shift'], ['wait', 300]])
ok('Shift-click selects', state()['sel'] == 1, state())
mouse([['key', 'Delete'], ['wait', 400]]); s4 = state(); ok('Delete removes', s4['placed'] == 1, s4)
mouse([['key', 'Control+z'], ['wait', 200]]); ok('undo brings it back', state()['placed'] == 2, state())

# 5. dragging onto the shelf removes
b = placed_px(0); lib = px('s.drum.drum.getWorldPosition(new s.v1.constructor())')
mouse([['move', b[0], b[1]], ['wait', 150], ['down'], ['move', lib[0], lib[1], 15], ['wait', 250]])
ok('shelf turns red under a held block', js('return s.drum.frameMat.color.getHex() !== 0xf1f2f4'))
mouse([['up'], ['wait', 400]]); ok('dropping on the shelf removes', state()['placed'] == 1, state())

# 6. orbit + zoom move the camera; F frames it again
c0 = js('return s.camera.position.toArray()')
mouse([['move', 600, 600], ['down', 'right'], ['move', 500, 560, 10], ['up', 'right'], ['wheel', 300], ['wait', 200]])
c1 = js('return s.camera.position.toArray()')
ok('right-drag orbits, wheel zooms', sum((a - b) ** 2 for a, b in zip(c0, c1)) > 1e-3, (c0, c1))
cli('browser', 'screenshot', '--output-file', ARTIFACTS + '/desktop.png')
