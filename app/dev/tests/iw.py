"""Tiny harness for driving the IWSDK emulator from Python (see docs/07-development.md).

Needs the dev server started with browser automation:
    npx iwsdk dev up --headless --ai-mode agent --allow-browser-automation
"""
import json, os, subprocess, sys, time
CWD = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ARTIFACTS = os.path.join(CWD, 'artifacts')
os.makedirs(ARTIFACTS, exist_ok=True)
def cli(*args, inp=None):
    cmd = ['npx', 'iwsdk', *args]
    if inp is not None: cmd += ['--input-json', json.dumps(inp)]
    out = subprocess.run(cmd, cwd=CWD, capture_output=True, text=True).stdout
    d = json.loads(out)
    if not d.get('ok'): raise RuntimeError(out[:800])
    return d['data'].get('result', d['data'])
def find(**kw): return cli('ecs', 'find', inp=kw)['entities']
def query(i): return cli('ecs', 'query', inp={'entityIndex': i})
def comps(i): return query(i)['components']
def pos(i): return comps(i)['Transform']['position']
def comps(i):
    return {c['componentId']: c.get('values', {}) for c in query(i)['components']}
def pos(i): return comps(i)['Transform']['position']
def move(dev, p, dur=0.3):
    cli('xr', 'animate-to', inp={'device': dev, 'position': {'x': p[0], 'y': p[1], 'z': p[2]}, 'duration': dur}); time.sleep(dur + 0.15)
def squeeze(dev, v):
    cli('xr', 'set-gamepad-state', inp={'device': dev, 'buttons': [{'index': 1, 'value': v}]}); time.sleep(0.25)
def top_loose_block():
    best = None
    for e in find(namePattern='^Block$', limit=50):
        c = comps(e['entityIndex'])
        if c['Block']['placed']: continue
        y = c['Transform']['position'][1]
        if best is None or y > best[1]: best = (e['entityIndex'], y, c['Transform']['position'])
    return best
def stick(dev, x=0, y=0):
    cli('xr', 'set-gamepad-state', inp={'device': dev, 'axes': [{'index': 0, 'value': x}, {'index': 1, 'value': y}]}); time.sleep(0.2)
def grabbed_blocks(): return [e['entityIndex'] for e in find(withComponents=['Block','Grabbed'])]
def yaw_deg(q):
    import math
    x,y,z,w = q
    return round(math.degrees(math.atan2(2*(w*y + x*z), 1 - 2*(y*y + x*x))),1)
def ensure_xr():
    if not cli('xr','status')['sessionActive']:
        cli('xr','enter'); time.sleep(4)
def qrot(q, v):
    x,y,z,w = q; vx,vy,vz = v
    ix = w*vx + y*vz - z*vy; iy = w*vy + z*vx - x*vz; iz = w*vz + x*vy - y*vx; iw_ = -x*vx - y*vy - z*vz
    return [ix*w + iw_*-x + iy*-z - iz*-y, iy*w + iw_*-y + iz*-x - ix*-z, iz*w + iw_*-z + ix*-y - iy*-x]
def world_of_child(child_idx):
    c = comps(child_idx)['Transform']; par = c['parent']['entityIndex']
    pt = comps(par)['Transform']
    r = qrot(pt['orientation'], c['position'])
    return [pt['position'][i] + r[i] for i in range(3)]
def probe():
    return cli('browser', 'run', 'dev/probe.mjs')
def look(dev, p):
    cli('xr', 'look-at', inp={'device': dev, 'target': {'x': p[0], 'y': p[1], 'z': p[2]}}); time.sleep(0.15)
def btn(dev, idx, v):
    cli('xr', 'set-gamepad-state', inp={'device': dev, 'buttons': [{'index': idx, 'value': v}]}); time.sleep(0.2)
def tip_at(dev, p, dur=0.3):
    # controller orientation identity → ray points -z; the near-grab tip sits 3.5 cm ahead
    cli('xr', 'set-transform', inp={'device': dev, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}})
    move(dev, [p[0], p[1], p[2] + 0.035], dur)
def call(method, *args):
    json.dump([method, *args], open(os.path.join(ARTIFACTS, 'eval.json'), 'w'))
    return cli('browser', 'run', 'dev/eval.mjs')
def js(code):
    open(os.path.join(ARTIFACTS, 'js.txt'), 'w').write(code)
    return cli('browser', 'run', 'dev/js.mjs')

def tab_id(name):
    """UI id of a library tab by its label (tab order changes as tabs are added)."""
    names = js('return [...Array(24).keys()].map((k) => s.uiLabel({ id: "tab:" + k, kind: "tab", value: k }))')
    return f"tab:{names.index(name)}"
