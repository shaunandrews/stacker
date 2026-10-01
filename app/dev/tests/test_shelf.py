"""Emulator regression test — run from app/: python3 dev/tests/test_shelf.py

The parts shelf: a six-sided drum you spin by its cap, side signs that turn it, paging,
paint jars you dip into, sample tiles for finishes, dropping blocks on it to delete them;
plus the wrist menu (palm up) and the controls list in Settings.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
L, R = 'controller-left', 'controller-right'
TRIGGER, GRIP = 0, 1
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def reset(dev): cli('xr', 'set-transform', inp={'device': dev, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
def ray_press(target, b=TRIGGER):
    move(R, [target[0] + 0.05, target[1] + 0.05, target[2] + 0.3], 0.25); look(R, target); time.sleep(0.2)
    btn(R, b, 1); btn(R, b, 0); time.sleep(0.2)
def drum(): return probe()['drum']
def wpos(expr): return js(f'return ({expr}).getWorldPosition(new s.v1.constructor()).toArray()')

ensure_xr()
cli('xr', 'set-transform', inp={'device': 'headset', 'orientation': {'pitch': -30, 'yaw': 35, 'roll': 0}})
js('s.exitKit(); s.clearPlaced(); s.wristPinned = false; s.facePage.fill(0); s.drum.angle = s.drum.target = 0; s.selectColor(s.lib.colorIndex.get(4)); s.recenter(); return 1'); time.sleep(0.6)
d = drum(); ok('shelf shows face 0 (Bricks)', d['face'] == 0 and len(probe()['previews']) == 12, d)

# 1. Spin by the top cap: swipe sideways and it turns to the next face
cap = js('return s.drum.caps[0].localToWorld(new s.v1.constructor(0, 0.008, 0.15)).toArray()')  # the cap's front edge, on top
side = js('return new s.v1.constructor(1, 0, 0).applyQuaternion(s.drum.root.getWorldQuaternion(new s.q1.constructor())).toArray()')
reset(R); tip_at(R, cap); btn(R, GRIP, 1); time.sleep(0.2)
held = js('return !!s.hands[1].spin'); ok('grabbing the cap starts a spin', held, js('return s.hands[1].target && s.hands[1].target.kind'))
cli('xr', 'animate-to', inp={'device': R, 'position': {'x': cap[0] + side[0] * 0.14, 'y': cap[1], 'z': cap[2] + side[2] * 0.14 + 0.035}, 'duration': 0.6}); time.sleep(0.8)
btn(R, GRIP, 0); time.sleep(0.8)
d1 = drum(); ok('a swipe turns it to another face, snapped', d1['face'] != 0 and abs((d1['angle'] / 1.0472) - round(d1['angle'] / 1.0472)) < 0.02, d1)

# 2. Tap a side face's sign: it turns there
js('s.drum.angle = s.drum.target = 0; return 1'); time.sleep(0.6)
sign = wpos('s.drum.faces[1].sign')
n = js('return new s.v1.constructor(0, 0, 1).applyQuaternion(s.drum.faces[1].group.getWorldQuaternion(new s.q1.constructor())).toArray()')
move(R, [sign[0] + n[0] * 0.4, sign[1] + 0.05, sign[2] + n[2] * 0.4], 0.25); look(R, sign); time.sleep(0.2)
btn(R, TRIGGER, 1); btn(R, TRIGGER, 0); time.sleep(0.9)
ok('tapping a side sign turns to that face', drum()['face'] == 1, drum())

# 3. Paging: the Bricks face has 2 pages
js('s.drum.angle = s.drum.target = 0; s.facePage[0] = 0; s.fillPartsShelf(); return 1'); time.sleep(0.6)
first = js('return s.cubbyEntry(0, 0)')
ray_press(wpos('s.drum.faces[0].next')); time.sleep(0.3)
ok('▶ pages the face', js('return s.facePage[0]') == 1 and js('return s.cubbyEntry(0, 0)') != first, js('return s.facePage[0]'))
ray_press(wpos('s.drum.faces[0].prev')); time.sleep(0.3)
ok('◀ pages back', js('return s.facePage[0]') == 0)

# 4. Dip the controller tip into a jar: that color
k = js('return s.lib.colorIndex.get(1)')  # blue
jar = wpos(f's.drum.jars[{k}].group')
reset(R); tip_at(R, [jar[0], jar[1] + 0.012, jar[2]]); time.sleep(0.3)
ok('dipping into a jar picks its color', js('return s.color') == k, (k, js('return s.color')))
ok('parts in the cubbies take it', js(f'return s.drum.faces[0].previews[0].material === s.matFor(s.finish, {k})'))
move(R, [jar[0], jar[1] + 0.12, jar[2] + 0.1], 0.2)
# ...or press one by ray
k2 = js('return s.lib.colorIndex.get(14)')  # yellow
ray_press(probe()['swatches'][k2])
ok('ray-pressing a jar picks it too', js('return s.color') == k2)

# 5. Touch a sample tile: that finish
tile = probe()['tiles'][1]
reset(R); tip_at(R, [tile[0], tile[1] + 0.004, tile[2]]); time.sleep(0.3)
ok('touching the wood tile sets the finish', js('return s.finish') == 1, js('return s.finish'))
move(R, [tile[0], tile[1] + 0.12, tile[2] + 0.1], 0.2)
js('s.pressProp({ type: "tile", value: 0 }); return 1')  # back to plastic (saved with the look)

# 6. Grab a part from a cubby, drop it on the shelf: gone
p0 = probe()['previews'][0]
reset(R); tip_at(R, p0); btn(R, GRIP, 1); time.sleep(0.2)
ok('a part comes out of its cubby', probe()['hands'][1]['pieces'] == 1)
c = wpos('s.drum.drum'); move(R, [c[0], c[1], c[2] + 0.035], 0.3); time.sleep(0.3)
ok('shelf turns red under a held block', js('return s.drum.frameMat.color.getHex() !== 0xf1f2f4'))
btn(R, GRIP, 0); time.sleep(0.4)
ok('dropping it on the shelf removes it', probe()['loose'] == 0 and probe()['placed'] == 0, (probe()['loose'], probe()['placed']))

# 7. Wrist menu: roll the left controller palm-up in front of you and it opens
head = js('return s.player.head.getWorldPosition(s.v1).toArray()')
move(L, [head[0] - 0.1, head[1] - 0.25, head[2] - 0.3], 0.3)
cli('xr', 'set-transform', inp={'device': L, 'orientation': {'yaw': 0, 'pitch': 0, 'roll': 0}}); time.sleep(0.5)
ok('menu closed with the hand palm-down', not probe()['wrist']['visible'], probe()['wrist'])
for roll in (90, -90):
    cli('xr', 'set-transform', inp={'device': L, 'orientation': {'yaw': 0, 'pitch': 0, 'roll': roll}}); time.sleep(0.5)
    if probe()['wrist']['visible']: break
w = probe()['wrist']; ok('palm up opens the wrist menu', w['visible'] and w['open'] > 0.9, (roll, w))
s = probe(); ray_press(s['ui']['tool:paint'])
ok('its buttons work (Paint)', probe()['tool'] == 'paint', probe()['tool'])
js('s.tool = "build"; return 1')
cli('xr', 'set-transform', inp={'device': L, 'orientation': {'yaw': 0, 'pitch': 0, 'roll': 0}}); time.sleep(0.6)
ok('palm down closes it', not probe()['wrist']['visible'], probe()['wrist'])

# 8. Settings → Controls lists the mappings
s = probe(); ray_press(s['ui']['controls']); time.sleep(0.3)
s = probe(); n = len([k for k in s['ui'] if k.startswith('ctl:')])
ok('Controls lists every mapping', n >= 20, n)
ray_press(s['ui']['controls'])
