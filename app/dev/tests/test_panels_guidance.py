"""Emulator regression test — run from app/: python3 dev/tests/test_panels_guidance.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
R = 'controller-right'
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
def aim_from(target, dx=0.05, dy=0.05, dz=0.3):
    move(R, [target[0] + dx, target[1] + dy, target[2] + dz], 0.25); look(R, target); time.sleep(0.15)
def ray_press(target, b=0):
    aim_from(target); btn(R, b, 1); btn(R, b, 0)
def reset_ctrl(): cli('xr','set-transform', inp={'device':R,'orientation':{'x':0,'y':0,'z':0,'w':1}})
cli('browser','reload'); time.sleep(6); cli('xr','enter'); time.sleep(3)
cli('xr','set-transform', inp={'device':'headset','orientation':{'pitch':-30,'yaw':0,'roll':0}})
# Guide mode and Advanced persist across reloads: start every run from the defaults.
js('s.exitKit(); s.clearPlaced(); s.instructions = "ghosts"; s.applyInstructions(); s.advanced = false; s.controlsOpen = false; s.layoutSettings(); s.recenter(); return 1')
s = probe()
# 1. look presets, Advanced, then a settings slider (key light) via ray drag
ray_press(s['ui']['style:3'])
s1 = probe(); ok('Studio preset fades the room', s1['visual']['backdrop'] > 0.5, s1['visual']['backdrop'])
ok('sliders hidden until Advanced', 'slider:key' not in s1['ui'])
ray_press(s1['ui']['advanced'])
s = probe(); ok('Advanced shows the sliders', 'slider:key' in s['ui'])
k = s['ui']['slider:key']
aim_from([k[0], k[1], k[2]]); btn(R, 0, 1); look(R, [k[0] + 0.08, k[1], k[2]]); time.sleep(0.3); btn(R, 0, 0)
s2 = probe(); ok('key light slider', abs(s2['visual']['key'] - s['visual']['key']) > 0.3, (s['visual']['key'], s2['visual']['key']))
ray_press(s2['ui']['tone'])
s3 = probe(); ok('tone toggle', s3['tone'] != s2['tone'], (s2['tone'], s3['tone']))
ray_press(s3['ui']['advanced'])
# 3. kit guidance: Go-Kart minifig step
js('await s.startKit("6400-1", "Go-Kart"); for (let k=0;k<6;k++) s.skipStep(); return 1')
s = probe(); t = s['kitTargets'][3]; kk = [x['part'] for x in s['shelf']].index(t['part'])
reset_ctrl(); tip_at(R, s['shelf'][kk]['w']); btn(R, 1, 1); time.sleep(0.3)
s4 = probe(); ok('holding a kit piece lights its ghost + guide line', s4['lit'][1] and s4['guide'][1], (s4['lit'], s4['guide']))
# carry roughly (within ~4cm) and release
g = t['w']; p = cli('browser','run','dev/held.mjs')['pos']
cpos = cli('xr','get-transform', inp={'device':R})['position']
cli('xr','set-transform', inp={'device':R,'position':{'x':cpos['x']+g[0]-p[0]+0.025,'y':cpos['y']+g[1]-p[1]+0.02,'z':cpos['z']+g[2]-p[2]-0.015}}); time.sleep(0.4)
btn(R, 1, 0); time.sleep(0.4)
s5 = probe(); ok('rough drop (≈3.5 cm off) still lands in the ghost', s5['kit']['remaining'] == s['kit']['remaining'] - 1, s5['kit'])
# 4. manual instructions
ray_press(s5['ui']['instructions'])
s6 = probe(); ok('manual booklet appears', s6['instructions'] == 'manual' and s6['manual'], (s6['instructions'], s6['manual']))
ray_press(s6['ui']['man:prev']); s7 = probe(); ok('page back', s7['page'] == s6['page'] - 1, (s6['page'], s7['page']))
r = s7['root']['p']
cli('xr','set-transform', inp={'device':R,'position':{'x':0.5,'y':0.8,'z':0.3}})
cli('xr','look-at', inp={'device':'headset','target':{'x':s7['ui']['man:title'][0],'y':s7['ui']['man:title'][1]-0.15,'z':s7['ui']['man:title'][2]}}); time.sleep(1.2)
cli('browser','screenshot','--output-file',ARTIFACTS + '/v7-manual.png')
ray_press(s7['ui']['man:here']); ok('back to current step', probe()['page'] == s6['page'])
