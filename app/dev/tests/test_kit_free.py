"""Emulator regression test — run from app/: python3 dev/tests/test_kit_free.py

Kits you can build your own way: page to any step and its pieces come out; place pieces
anywhere; parked pieces stay; each step remembers what's done; the kit finishes when
every step is.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
TRIGGER, GRIP = 0, 1
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def reset(dev): cli('xr', 'set-transform', inp={'device': dev, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
def ray_press(target):
    move(R, [target[0] + 0.05, target[1] + 0.05, target[2] + 0.3], 0.25); look(R, target); time.sleep(0.2)
    btn(R, TRIGGER, 1); btn(R, TRIGGER, 0); time.sleep(0.3)
def kit(): return js('const k = s.kit; return k && { step: k.step, steps: k.steps.length, ghosts: k.remaining.length, shelf: s.shelfItems.length, size: k.steps[k.step].length, done: k.done.map((d) => d.every(Boolean)), loose: s.loose.length, placed: s.placedRecs.length }')

ensure_xr()
cli('xr', 'set-transform', inp={'device': 'headset', 'orientation': {'pitch': -40, 'yaw': 0, 'roll': 0}})
js('s.exitKit(); s.clearPlaced(); s.wristPinned = true; return 1')
js('await s.startKit("7796-1", "House"); return 1'); time.sleep(1)
k0 = kit(); ok('kit starts on step 1', k0['step'] == 0 and k0['shelf'] == k0['size'], k0)

# 1. Page ahead without building anything: that step's pieces come out
s = probe(); ray_press(s['ui']['kit:next']); ray_press(probe()['ui']['kit:next'])
k1 = kit(); ok('▶ on the wrist menu pages ahead freely', k1['step'] == 2, k1)
ok('the shelf holds that step’s pieces, and its ghosts show', k1['shelf'] == k1['size'] and k1['ghosts'] == k1['size'], k1)
arrow = js('return s.shelfArrows[0].getWorldPosition(new s.v1.constructor()).toArray()')
ray_press(arrow)
ok('◀ on the kit shelf pages back', kit()['step'] == 1, kit())

# 2. Place a shelf piece anywhere: allowed, the step stays
s = probe(); piece = s['shelf'][0]['w']; plate = js('return s.plateCenter(s.v1).toArray()')
reset(R); tip_at(R, piece); btn(R, GRIP, 1); time.sleep(0.2)
far_spot = js('const P = 0.008, b = s.bounds; return s.root.object3D.localToWorld(new s.v1.constructor((b.x0 + 2) * P, 0.02, (b.z0 + 2) * P)).toArray()')
tip_at(R, far_spot, 0.5); time.sleep(0.2); btn(R, GRIP, 0); time.sleep(0.5)
k2 = kit(); ok('a kit piece placed off its ghost stays put', k2['placed'] == 1 and k2['step'] == 1, k2)

# 3. Park a piece in the air, change step: it stays; the shelf swaps
s = probe(); piece = s['shelf'][0]['w']
reset(R); tip_at(R, piece); btn(R, GRIP, 1); time.sleep(0.2)
move(R, [plate[0], plate[1] + 0.35, plate[2] + 0.2], 0.4); btn(R, GRIP, 0); time.sleep(0.4)
loose_before = kit()['loose']
js('s.goToStep(3); return 1'); time.sleep(0.4)
k3 = kit(); ok('parked pieces stay when you change step', k3['loose'] - k3['shelf'] >= 1, k3)
ok('the new step’s pieces come out', k3['step'] == 3 and k3['shelf'] == k3['size'], k3)

# 4. "Place it" finishes a step and moves on to the next one with pieces left
js('s.goToStep(1); return 1'); time.sleep(0.3)
s = probe(); ray_press(s['ui']['kit:skip']); time.sleep(0.4)
k4 = kit(); ok('Place it: step 2 done, on to step 3', k4['done'][1] and k4['step'] == 2, k4)
js('s.goToStep(1); return 1'); time.sleep(0.3)
k5 = kit(); ok('back on a done step: nothing left to take', k5['shelf'] == 0 and k5['ghosts'] == 0, k5)
ok('its label says ✓', '✓' in js('return s.uiLabel(s.wrist.items.find((u) => u.id === "kit:step"))'))

# 5. Take a done piece off: its ghost comes back
js('const m = [...s.kit.matched].find(([, v]) => v.step === 1); s.removePlaced(m[0]); return 1'); time.sleep(0.3)
k6 = kit(); ok('removing a matched piece reopens its ghost', k6['ghosts'] == 1 and not k6['done'][1], k6)

# 6. Finish everything (in any order): the kit ends
js('for (let i = 0; i < 60 && s.kit; i++) s.skipStep(); return 1'); time.sleep(1)
ok('the kit finishes when every step is done', kit() is None and probe()['placed'] >= 56, probe()['placed'])
js('s.clearPlaced(); s.wristPinned = false; return 1')
