from iw import *
H = open(os.path.join(os.path.dirname(__file__), 'hinge_helpers.js')).read()
R = 'controller-right'
def hjs(code): return js(H + code)
def reset():
    ensure_xr()
    hjs('s.exitKit(); s.clearPlaced(); const h = 16; s.bounds = { x0: -h, x1: h, z0: -h, z1: h }; s.updatePlate(); s.recenter(); return 1')
    move('headset', [0, 1.6, 0], 0.1); look('headset', [0, 1.2, -0.45])
def build_hinge():
    return hjs('''const b = place("3937", 4, [0.004, 0.02, -0.04]);
const t = b && place("3938", 4, [0.004, 0.035, -0.04]);
const k = t && place("3001", 1, [0.004, 0.05, -0.04]);
window.T = { b, t, k };
return { base: b && P(b), top: t && P(t), brick: k && P(k) };''')
def view_local(eye, target, name):
    w = hjs(f'const r = s.root.object3D; return [r.localToWorld(new V(...{list(eye)})).toArray(), r.localToWorld(new V(...{list(target)})).toArray()]')
    move('headset', w[0], 0.1); look('headset', w[1]); time.sleep(0.4)
    cli('browser', 'screenshot', '--output-file', f'artifacts/{name}.png')
def build_window():
    return hjs('''const f = place("3853", 15, [0.0, 0.03, -0.04]);
const fp = P(f);
const at = (dx, dy, dz) => [fp[0]+dx, fp[1]+dy, fp[2]+dz];
const pl = place("3854", 47, at(-0.008, 0.0, 0.002), 0);
const pr = place("3854", 47, at(0.008, 0.0, 0.002), 180);
const sl = place("3856", 4, at(-0.024, 0.0, 0.004), 0);
const sr = place("3856", 4, at(0.024, 0.0, 0.004), 180);
window.T = {f, pl, pr, sl, sr};
return s.placedRecs.length;''')
def L2W(p): return hjs(f'return s.root.object3D.localToWorld(new V(...{list(p)})).toArray()')
def swing_local(key, degs, eye_off=(0.0, 0.12, 0.12), radius=0.012, hold=False, hinge=None):
    """Aim at a placed part from eye_off (platform-local, relative to the part), grab, sweep the aim around its hinge."""
    import math
    hk = hinge or key
    piv = hjs(f'const t=window.T.{hk}; return new V(...s.lib.parts[t.part].hinge.p).multiplyScalar(0.0004).applyMatrix4(t.m).toArray()')
    c = hjs(f'return P(window.T.{key})')
    move(R, L2W([c[0]+eye_off[0], c[1]+eye_off[1], c[2]+eye_off[2]]), 0.2); look(R, L2W(c)); time.sleep(0.3)
    tgt = js('const t=s.hands[1].target; return t && [t.kind, t.placed && s.lib.parts[t.placed.part].id]')
    btn(R, 0, 1); time.sleep(0.2)
    sw = js('const w=s.hands[1].swing; return w && s.lib.parts[w.rec.part].id')
    a0 = math.atan2(c[2]-piv[2], c[0]-piv[0])
    for d in degs:
        th = a0 + math.radians(d)
        look(R, L2W([piv[0]+radius*math.cos(th), piv[1], piv[2]+radius*math.sin(th)])); time.sleep(0.2)
    ang = hjs(f'return +((window.T.{hk}.swing||0)*180/Math.PI).toFixed(1)')
    if not hold: btn(R, 0, 0); time.sleep(0.2)
    return tgt, sw, ang
