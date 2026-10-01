"""Emulator regression test — run from app/: python3 dev/tests/test_box_camera.py

The box camera: grab it off the rack, photograph the build, and a box of your own lands
on the rack's top tier; it survives a reload, opens as a kit, and the library deletes it.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
GRIP, A = 1, 3
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def reset_ctrl(): cli('xr', 'set-transform', inp={'device': R, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
def mine(): return js('return s.myBoxes.length')
def cam(): return js('const c = s.snapCam; return { state: c.state, p: c.group.getWorldPosition(s.v1).toArray(), visible: c.group.visible, frame: s.viewFrame }')

ensure_xr()
cli('xr', 'set-transform', inp={'device': 'headset', 'orientation': {'pitch': -20, 'yaw': -30, 'roll': 0}})
# Start clean: no boxes of your own, and the House built on the plate
js('for (const b of s.boxes.filter((b) => b.kit.mine)) s.deleteMyBox(b); s.exitKit(); s.clearPlaced(); s.setScale(1); s.recenter(); return 1')
js('await s.startKit("7796-1", "House"); for (let i = 0; i < 40 && s.kit; i++) s.skipStep(); return 1'); time.sleep(1.5)
n = probe()['placed']; ok('house built', n == 56, n)
c = cam(); ok('camera sits on the rack', c['state'] == 'home' and c['visible'], c)
ok('empty-tier hint shows', js('return s.rackHint.visible'))
# Grab it
reset_ctrl(); tip_at(R, c['p']); btn(R, GRIP, 1); time.sleep(0.6)
c2 = cam(); ok('camera comes to the hand', c2['state'] == 'held' and js('return s.hands[1].camera'), c2)
ok('viewfinder updates', c2['frame'] > c['frame'], (c['frame'], c2['frame']))
# Point it at the build and shoot
# Hold it so the lens faces the build (as you would by looking at the screen)
js('const h = s.hands[1]; const V = s.v1.constructor; const c = s.plateCenter(new V()); const o = new s.snapCam.group.constructor(); o.position.copy(s.snapCam.group.position); o.lookAt(c); o.rotateY(Math.PI); h.offsetQuat.copy(h.quat).invert().multiply(o.quaternion); return 1')
time.sleep(0.6)
drawn = js('const d = s.snapCam.view.getContext("2d").getImageData(0, 0, 192, 192).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n')
ok('viewfinder shows the build', drawn > 200, drawn)
btn(R, A, 1); btn(R, A, 0); time.sleep(0.8)
ok('shutter boxes the build', mine() == 1, mine())
b = js('const b = s.boxes.find((b) => b.kit.mine); return { state: b.state, visible: b.mesh.visible, title: b.kit.title, pieces: b.kit.pieces, y: s.rack.object3D.worldToLocal(b.mesh.position.clone()).y }')
ok('the box lands on the top tier', b['state'] == 'rack' and b['visible'] and b['y'] > 0.3, b)
ok('box carries the build', b['pieces'] == 56 and b['title'] == 'My build 1', b)
ok('hint hides', not js('return s.rackHint.visible'))
stored = js('const a = JSON.parse(localStorage.getItem("stacker.boxes")); return { n: a.length, photo: a[0].photo.slice(0, 15), kb: Math.round(a[0].photo.length / 1024), steps: a[0].steps.length }')
ok('stored on the device with its photo', stored['n'] == 1 and stored['photo'].startswith('data:image/'), stored)
btn(R, GRIP, 0); time.sleep(0.6)
ok('camera flies home', cam()['state'] == 'home')
# Reload: still there
cli('browser', 'reload'); time.sleep(7); cli('xr', 'enter'); time.sleep(3)
ok('survives a reload', js('return s.myBoxes.length === 1 && !!s.boxes.find((b) => b.kit.mine)'))
# Opens as a kit with every piece
mb = js('const b = s.boxes.find((b) => b.kit.mine); return [b.kit.id, b.kit.title]')
js(f'await s.startKit("{mb[0]}", "{mb[1]}"); return 1'); time.sleep(1)
k = js('return { steps: s.kit.steps.length, pieces: s.kit.steps.flat().length }')
ok('opens as a kit', k['pieces'] == 56 and k['steps'] >= 10, k)
js('for (let i = 0; i < 40 && s.kit; i++) s.skipStep(); return 1'); time.sleep(1)
ok('the kit rebuilds all of it', probe()['placed'] == 56, probe()['placed'])
# Drop it on the library: deleted
js('s.exitKit(); return 1'); time.sleep(0.5)
bp = js('const b = s.boxes.find((b) => b.kit.mine); return b.mesh.getWorldPosition(s.v1).toArray()')
reset_ctrl(); tip_at(R, bp); btn(R, GRIP, 1); time.sleep(0.4)
# Put the box's center just in front of the library (the box sits ahead of the controller)
tgt = js('const V = s.v1.constructor; const bg = s.library.bg; const c = bg.getWorldPosition(new V()); const n = new V(0, 0, 1).applyQuaternion(bg.getWorldQuaternion(new s.q1.constructor())); const want = c.addScaledVector(n, 0.03); const h = s.hands[1]; const off = h.box.mesh.position.clone().sub(h.point); return want.sub(off).toArray()')
move(R, [tgt[0], tgt[1], tgt[2] + 0.035], 0.6); time.sleep(0.5)
red = js('return s.library.bg.material.color.getHex() !== 0x1b1f29')
ok('library turns red under your box', red)
btn(R, GRIP, 0); time.sleep(0.5)
ok('dropping it on the library deletes it', mine() == 0 and not js('return !!s.boxes.find((b) => b.kit.mine)'), mine())
js('s.clearPlaced(); return 1')
