"""Emulator regression test — run from app/: python3 dev/tests/test_kits.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
def ok(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name, extra)
def ray_press(target, b=0):
    move(R, [target[0] + 0.05, target[1] + 0.05, target[2] + 0.3], 0.25); look(R, target); time.sleep(0.15)
    btn(R, b, 1); btn(R, b, 0)
def reset_ctrl(): cli('xr','set-transform', inp={'device':R,'orientation':{'x':0,'y':0,'z':0,'w':1}})
def carry_to(g, dy=0.004):
    # nudge until the held block sits on the target (the ghost magnet does the rest)
    c = cli('xr','get-transform', inp={'device':R})['position']; c=[c['x'],c['y'],c['z']]
    for _ in range(3):
        p = cli('browser','run','dev/held.mjs')['pos']; d = [g[0]-p[0], g[1]+dy-p[1], g[2]-p[2]]
        c = [c[i]+d[i] for i in range(3)]
        cli('xr','set-transform', inp={'device':R,'position':{'x':c[0],'y':c[1],'z':c[2]}}); time.sleep(0.3)
def kit_start(k):
    s = probe(); ray_press(s['ui'][tab_id('Kits')]); s = probe(); ray_press(s['ui'][f'cell:{k}']); time.sleep(1)
    return probe()
cli('xr','set-transform', inp={'device':'headset','orientation':{'pitch':-40,'yaw':0,'roll':0}})
# House: grab from shelf, carry near ghost → magnet, match
s = kit_start(0)
ok('house kit started with shelf', s['kit'] and s['kit']['shelf'] == s['kit']['remaining'] > 0, s['kit'])
t = s['kitTargets'][2]  # a rotated (turns=1) 2x4 plate
k = [x['part'] for x in s['shelf']].index(t['part'])
reset_ctrl(); tip_at(R, s['shelf'][k]['w']); btn(R, 1, 1)
ok('grab from shelf', probe()['hands'][1]['pieces'] == 1)
carry_to(t['w'], 0.01)
h = cli('browser','run','dev/held.mjs'); ok('ghost magnet (rotation fixed for you)', h['snap'] and h['snap'][0]['target'], h['snap'])
btn(R, 1, 0); time.sleep(0.4)
s2 = probe(); ok('placed into ghost', s2['kit']['remaining'] == s['kit']['remaining'] - 1, s2['kit'])
# grab it back off → ghost returns
b = [p for p in s2['placedList'] if p['part'] == t['part'] and p['turns'] == t['turns']][0]['w']
reset_ctrl(); tip_at(R, b); btn(R, 1, 1); time.sleep(0.2)
ok('pulling it back restores the ghost', probe()['kit']['remaining'] == s['kit']['remaining'])
move(R, [b[0], b[1] + 0.25, b[2] + 0.2], 0.3); btn(R, 1, 0); time.sleep(0.3)   # park it in the air
# restart step → everything back on the shelf
s3 = probe(); ray_press(s3['ui']['row:mid']); time.sleep(0.5)
s4 = probe(); ok('restart step refills shelf', s4['kit']['shelf'] == s['kit']['shelf'] and s4['kit']['remaining'] == s['kit']['remaining'], s4['kit'])
# move the shelf by its bar
bar = s4['shelfBar']; sh0 = s4['shelf'][0]['w']
reset_ctrl(); tip_at(R, bar); btn(R, 1, 1); move(R, [bar[0] + 0.1, bar[1] + 0.05, bar[2] + 0.035], 0.4); btn(R, 1, 0)
s5 = probe(); ok('shelf moves with its pieces', s5['shelf'][0]['w'][0] > sh0[0] + 0.08, (sh0, s5['shelf'][0]['w']))
cli('browser','screenshot','--output-file',ARTIFACTS + '/v6-kit.png')
# Go-Kart: free parts snap via ghosts, and skip completes
s = kit_start(1)
ok('go-kart started', s['kit'] is not None, s['kit'])
free_found = False
for n in range(12):
    s = probe()
    if not s['kit']: break
    tf = [t for t in s['kitTargets'] if t['free']]
    if tf and not free_found:
        t = tf[0]; k = [x['part'] for x in s['shelf']].index(t['part'])
        reset_ctrl(); tip_at(R, s['shelf'][k]['w']); btn(R, 1, 1); carry_to(t['w'], 0.0)
        h = cli('browser','run','dev/held.mjs'); btn(R, 1, 0); time.sleep(0.4)
        s2 = probe(); free_found = True
        ok('free part (%s) snaps into its ghost' % t['part'], s2['kit'] and s2['kit']['remaining'] == s['kit']['remaining'] - 1 or s2['kit']['step'] > s['kit']['step'], (h['snap'], s2['kit']))
        continue
    ray_press(s['ui']['row:right']); time.sleep(0.3)
s = probe(); ok('go-kart completes', s['kit'] is None and s['placed'] == 29, s['placed'])
