"""Emulator regression test — run from app/: python3 dev/tests/test_rooms.py

Rooms, the parts that don't need a server: first grab wins (a block another player holds
can't be picked up or deleted), your pose names the block you hold, and other players are
drawn from their poses (VR: head and hands; desktop: camera and cursor).
The relay and the capsule themselves are checked on a Space (docs/11).
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
HASH = 'const hash = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0) || 1; };'

ensure_xr()
js('s.exitKit(); s.clearPlaced(); s.remoteLocks.clear(); return 1')
rid = js('const p = s.lib.byId.get("3003"); const r = s.makeRec(p, s.lib.colorIndex.get(4), s.gridMatrix(p, 0, 0, 0, 0)); s.addPlaced(r); return r.id')
time.sleep(0.3)

# Someone else holds it: you can't take it or delete it
js(HASH + f'const r = s.recById.get("{rid}"); s.remoteLocks.set(hash(r.id), "#e11d48"); s.holdPlaced(s.hands[1], "trigger", r, [r], false); return 1')
ok('a block someone else holds stays put', js(f'return !!s.recById.get("{rid}") && !s.hands[1].pieces'))
js(f'const r = s.recById.get("{rid}"); s.onDelete({{ kind: "placed", placed: r, score: 0 }}); return 1')
ok('and can’t be deleted', js(f'return !!s.recById.get("{rid}")'))

# Once they let go it's yours, and your pose says you hold it
js(f's.remoteLocks.clear(); const r = s.recById.get("{rid}"); s.holdPlaced(s.hands[1], "trigger", r, [r], false); return 1')
held = js(HASH + f'const p = {{ kind: 0, holding: false, held: 0, xf: new Float32Array(28) }}; s.samplePose(p); return {{ pieces: !!s.hands[1].pieces, lock: s.hands[1].lockId, holding: p.holding, held: p.held, want: hash("{rid}"), headY: p.xf[1] }}')
ok('you can pick it up when it’s free', held['pieces'] and held['lock'] == rid, held)
ok('your pose names the block you hold', held['holding'] and held['held'] == held['want'], held)
js('s.releasePieces(s.hands[1]); return 1'); time.sleep(0.5)
CLEAN = 'for (const l of [...s.loose]) s.dropLoose(l, true); return 1'
held2 = js('const p = { kind: 0, holding: false, held: 0, xf: new Float32Array(28) }; s.samplePose(p); return { holding: p.holding, kind: p.kind }')
ok('letting go clears it', not held2['holding'], held2)
ok('a headset player sends a VR pose', held2['kind'] == 1, held2)

# Other players are drawn from their poses
js('''const xf = new Float32Array(28); for (let k = 0; k < 4; k++) xf[k * 7 + 6] = 1;
xf.set([0, 0.4, 0.3], 0); xf.set([-0.15, 0.2, 0.2], 7); xf.set([0.15, 0.2, 0.2], 14);
s.rooms.code = "TEST";
s.rooms.remotes = [{ key: "k1", player: "abc", name: "Robin", color: "#22c55e", pose: { kind: 1, holding: false, room: 0, player: 1, color: 1, held: 0, xf }, at: 0 },
  { key: "k2", player: "def", name: "Sam", color: "#3b82f6", pose: { kind: 0, holding: false, room: 0, player: 2, color: 2, held: 0, xf: xf.slice() }, at: 0 }];
return 1''')
time.sleep(0.5)
av = js('''const kids = s.avatars.root.children; const vis = kids.filter((o) => o.visible).length;
const r = s.root.object3D; const head = new s.v1.constructor(0, 0.4, 0.3); r.localToWorld(head);
const d = kids.find((o) => o.type === "Group" && o.visible)?.position.distanceTo(head);
return { kids: kids.length, vis, d }''')
ok('remote players get bodies (two players, seven parts each)', av['kids'] == 14, av)
ok('a VR player shows head, hands and name; a desktop player camera, cursor and name', av['vis'] == 7, av)
ok('they sit where their pose says, through your plate', av['d'] is not None and av['d'] < 0.01, av)
# In a room the wrist menu gets the room's controls (VR players join by link)
items = js('s.layoutWrist(); return s.wrist.items.map((u) => u.id)')
ok('the wrist menu shows the room, voice, mute and leave', all(i in items for i in ['room:info', 'room:voice', 'room:mute', 'room:leave']), items)
ok('mute waits until you join voice', js('return s.uiDisabled(s.wrist.items.find((u) => u.id === "room:mute"))'))
js('s.rooms.code = null; s.rooms.remotes = []; s.avatars.clear(); s.clearPlaced(); s.layoutWrist(); return 1'); js(CLEAN); time.sleep(0.6)
ok('nothing left lying around', js('return s.loose.length') == 0)
ok('and goes away outside a room', not any(i.startswith('room:') for i in js('return s.wrist.items.map((u) => u.id)')))
ok('leaving clears them', js('return s.avatars.root.children.length') == 0)
