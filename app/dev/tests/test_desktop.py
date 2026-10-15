"""Emulator regression test for desktop (mouse + keyboard) play — run from app/: python3 dev/tests/test_desktop.py

The HUD (parts drawer, hotbar, swatches), the brush (pick, stamp, rotate, put down), the
eyedropper, box-select, copy / paste / duplicate, undo, deleting onto the drawer, the
trackpad-style camera (pan, pinch, orbit), focus, and kits in the HUD panel.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
PROJ = 'const px = (v) => { const p = v.clone().project(s.camera); return [Math.round((p.x+1)/2*innerWidth), Math.round((1-p.y)/2*innerHeight)]; };'
def px(expr): return js(PROJ + f'return px({expr});')
def placed_px(k): return px(f'(()=>{{const p=new s.v1.constructor(), q=new s.q1.constructor(); s.placedWorldPose(s.placedRecs[{k}],p,q); return p;}})()')
def plate_px(dx=0, dz=0): return px(f's.root.object3D.localToWorld(s.root.object3D.worldToLocal(s.plateCenter(new s.v1.constructor())).add(new s.v1.constructor({dx}, 0, {dz})))')
def rect(sel): return js(f'const r = document.querySelector("{sel}").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]')
def mouse(steps):
    json.dump(steps, open(ARTIFACTS + '/mouse.json', 'w'))
    return cli('browser', 'run', 'dev/mouse.mjs')
def key(chord): mouse([['key', chord], ['wait', 150]])
def state(): return js('return { placed: s.placedRecs.length, undo: s.undoStack.length, redo: s.redoStack.length, sel: s.selection.size, held: !!s.hands[1].pieces, brush: s.hands[1].holdButton === "brush", color: s.color, part: s.hands[1].pieces ? s.lib.parts[s.hands[1].pieces[0].block.part].id : null, n: s.hands[1].pieces ? s.hands[1].pieces.length : 0 }')
def wheel(dx, dy, ctrl=False, alt=False):
    js(f'const c = s.renderer.domElement, r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent("wheel", {{ deltaX: {dx}, deltaY: {dy}, ctrlKey: {str(ctrl).lower()}, altKey: {str(alt).lower()}, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }})); return 1')
def cam(): return js('const d = s.desktop; return { t: d.target.toArray(), az: d.azimuth, el: d.elevation, dist: d.distance }')

cli('browser', 'reload'); time.sleep(6)
ok('splash offers both ways in', js('return !document.getElementById("splash").classList.contains("hidden") && document.getElementById("splash").classList.contains("ready")'))
js('document.getElementById("enter-desktop").click(); return 1'); time.sleep(1)
ok('desktop mode on, splash hidden', js('return s.desktop.enabled && document.getElementById("splash").classList.contains("hidden")'))
js('localStorage.removeItem("stacker.hotbar"); const r = s.root.object3D; s.placeDefault(r.position.clone(), s.yawOf(r.quaternion)); s.frameCamera(); s.exitKit(); s.clearPlaced(); s.undoStack.length = 0; s.selectColor(s.lib.colorIndex.get(4)); return 1')
time.sleep(0.5)
ok('the HUD shows; the VR shelf and wrist menu hide', js('return !document.getElementById("play").hidden && !s.drum.root.visible && !s.wrist.entity.object3D.visible'))

# 1. Pick a part in the drawer: it rides the cursor as a brush
tile = rect('#play .grid .tile')
mouse([['move', tile[0], tile[1]], ['down'], ['up'], ['wait', 200]])
p0 = plate_px(); mouse([['move', p0[0], p0[1], 10], ['wait', 300]])
st = state(); ok('clicking a part loads the brush', st['brush'] and st['part'] == '3004', st)
mouse([['down'], ['up'], ['wait', 300]])
st = state(); ok('click places a copy, brush stays', st['placed'] == 1 and st['brush'], st)
p1 = plate_px(0.04, 0); mouse([['move', p1[0], p1[1], 10], ['wait', 300], ['down'], ['up'], ['wait', 300]])
ok('click again stamps another', state()['placed'] == 2, state())
yaw0 = js('return s.hands[1].rotTarget.y'); key('r'); time.sleep(0.2)
ok('R turns the brush', abs(js('return s.hands[1].rotTarget.y') - yaw0) > 0.3)
key('Escape'); time.sleep(0.2)
ok('Esc puts the brush down', not state()['held'], state())
ok('the part went into the hotbar', js('return s.hud.slot(0) && s.lib.parts[s.hud.slot(0).part].id') == '3004')
key('1'); time.sleep(0.2); ok('1 loads the hotbar’s first part', state()['brush'] and state()['part'] == '3004')
key('Escape')

# 2. Swatch: the brush (and next parts) take the color
blue = js('return s.lib.colorIndex.get(1)')
sw = js(f'const r = document.querySelectorAll("#play .sw")[{blue}].getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]')
mouse([['move', sw[0], sw[1]], ['down'], ['up'], ['wait', 200]])
ok('a swatch sets the color', state()['color'] == blue)

# 3. Eyedropper: ⌥-click a placed block loads its part and color
b = placed_px(0)
mouse([['move', b[0], b[1]], ['wait', 150], ['keydown', 'Alt'], ['down'], ['up'], ['keyup', 'Alt'], ['wait', 300]])
st = state(); ok('⌥-click is the eyedropper', st['brush'] and st['part'] == '3004' and st['color'] == js('return s.lib.colorIndex.get(4)'), st)
key('Escape')

# 4. Box-select (⇧-drag over empty space), copy, paste
a0 = plate_px(-0.12, -0.08); a1 = plate_px(0.12, 0.08)
mouse([['move', a0[0], a0[1]], ['keydown', 'Shift'], ['down'], ['move', a1[0], a1[1], 12], ['wait', 150], ['up'], ['keyup', 'Shift'], ['wait', 300]])
ok('⇧-drag box-selects', state()['sel'] == 2, state())
key('Meta+c'); key('Meta+v'); time.sleep(0.2)
st = state(); ok('⌘C ⌘V puts the group on the brush', st['brush'] and st['n'] == 2, st)
p2 = plate_px(0, 0.06); mouse([['move', p2[0], p2[1], 10], ['wait', 300], ['down'], ['up'], ['wait', 300]])
ok('stamping the group places both', state()['placed'] == 4, state())
key('Escape')

# 5. Undo / redo
key('Meta+z'); s2 = state(); ok('undo', s2['placed'] == 2 and s2['redo'] >= 1, s2)
key('Meta+Shift+z'); s3 = state(); ok('redo', s3['placed'] == 4, s3)

# 6. Drag a placed block onto the parts drawer: deleted
js('s.selection.clear(); return 1')
b = placed_px(0); drawer = rect('#play .drawer')
mouse([['move', b[0], b[1]], ['wait', 150], ['down'], ['move', drawer[0], drawer[1], 15], ['wait', 250]])
ok('the drawer turns red under a carried block', js('return document.querySelector("#play .drawer").classList.contains("trash")'))
mouse([['up'], ['wait', 400]]); ok('dropping on the drawer deletes', state()['placed'] == 3, state())

# 7. Camera: two-finger pan, pinch zoom, ⌥-scroll orbit, double-click focus, F
c0 = cam(); wheel(40, 30); c1 = cam()
ok('two-finger scroll pans', c0['t'] != c1['t'] and abs(c0['dist'] - c1['dist']) < 1e-6, (c0['t'], c1['t']))
wheel(0, 20, ctrl=True); c2 = cam(); ok('pinch zooms', c2['dist'] > c1['dist'], (c1['dist'], c2['dist']))
wheel(30, 0, alt=True); c3 = cam(); ok('⌥ + scroll orbits', abs(c3['az'] - c2['az']) > 0.1, (c2['az'], c3['az']))
mouse([['move', 600, 600], ['down', 'right'], ['move', 520, 560, 10], ['up', 'right'], ['wait', 150]])
ok('right-drag orbits', abs(cam()['az'] - c3['az']) > 0.1)
mouse([['wheel', 300], ['wait', 100]]); ok('a mouse wheel zooms', abs(cam()['dist'] - c3['dist']) > 1e-3)
key('f'); b = placed_px(0)
mouse([['move', b[0], b[1]], ['wait', 120], ['down'], ['up'], ['wait', 60], ['down'], ['up'], ['wait', 300]])
js('const c = s.renderer.domElement; c.dispatchEvent(new MouseEvent("dblclick", { clientX: ' + str(b[0]) + ', clientY: ' + str(b[1]) + ', bubbles: true })); return 1'); time.sleep(0.3)
c4 = cam(); ok('double-click focuses a block', c4['dist'] <= 0.35, c4)

# 8. Kits: the HUD menu starts one; the manual shows in the side panel; the hotbar holds the step's pieces
js('s.clearPlaced(); return 1')
mouse([['move', *rect('#play .top button:nth-of-type(6)')], ['down'], ['up'], ['wait', 200]])
ok('Kits menu opens', js('return !document.querySelector("#play .menu").hidden'))
js('document.querySelector("#play .menu button").click(); return 1'); time.sleep(1.5)
ok('kit starts with its HUD panel', js('return !!s.kit && !document.querySelector("#play .kit").hidden'))
ok('the 3D kit tray hides on the desktop', js('return !s.shelf.object3D.visible'))
n = js('return s.hud.slot(0) && s.kit.remaining.length')
ok('the hotbar holds the step’s pieces', bool(n), n)
key('f'); time.sleep(0.2); key('1'); time.sleep(0.2); t = js('const g = s.kit.remaining[0].rec; return s.placedWorldPose(g, s.v1, s.q1), s.v1.toArray()')
tp = px(f'new s.v1.constructor({t[0]}, {t[1]}, {t[2]})'); mouse([['move', tp[0], tp[1], 10], ['wait', 300], ['down'], ['up'], ['wait', 400]])
ok('stamping onto a ghost fills it', js('return s.kit.done[s.kit.step].some(Boolean) || s.kit.step > 0'))
js('s.putBrushDown(); s.exitKit(); s.clearPlaced(); return 1')
cli('browser', 'screenshot', '--output-file', ARTIFACTS + '/desktop.png')
