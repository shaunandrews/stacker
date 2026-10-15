"""Emulator regression test — run from app/: python3 dev/tests/test_edits.py

Edits and players: settled edits carry stable block ids; another player's edits apply by
id and stay out of your undo; undo takes back only yours (skipping blocks someone else
removed) and goes out as an edit too; snapshots round-trip with ids; a kit is one undo step.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from iw import *
def ok(name, cond, extra=''): print(('PASS ' if cond else 'FAIL ') + name, extra)
PLACE = 'const p = s.lib.byId.get("3003"); const r = s.makeRec(p, s.lib.colorIndex.get(4), s.gridMatrix(p, __I__, __J__, 0, 0)); s.addPlaced(r); return r.id'
def place(i, j): return js(PLACE.replace('__I__', str(i)).replace('__J__', str(j)))
def settle(): time.sleep(0.4)
def st(): return js('return { n: s.placedRecs.length, undo: s.undoStack.length, redo: s.redoStack.length, ids: s.placedRecs.map((r) => r.id), sent: window.__sent.length }')

ensure_xr()
js('s.exitKit(); s.clearPlaced(); s.undoStack.length = 0; s.redoStack.length = 0; window.__sent = []; s.onEdit = (e) => window.__sent.push(e); return 1'); settle()
js('s.resetStable(); s.undoStack.length = 0; window.__sent.length = 0; return 1')
a = place(0, 0); settle(); b = place(4, 0); settle()
s0 = st(); ok('local edits settle into undo steps and go out', s0['undo'] == 2 and s0['sent'] == 2, s0)
ok('blocks carry ids from this player', a.split('.')[0] == js('return s.playerId') and a != b, (a, b))
edit = js('return window.__sent[0]')
ok('an edit names the block and its spec', edit['set'][0][0] == a and edit['set'][0][1] is None and edit['set'][0][2].startswith('3003|4|plastic|'), edit['set'][0][:2])

# Another player adds a block: it appears, and isn't in your undo
spec = edit['set'][0][2].replace('3003|4|', '3003|1|')  # same spot, blue
spec = js(f'const p = s.lib.byId.get("3003"); const m = s.gridMatrix(p, 8, 0, 0, 0); return "3003|1|plastic|" + m.elements.map((v) => Math.round(v * 1e5) / 1e5).join(",")')
js(f's.applyRemote({{ set: [["other.1", null, "{spec}"]] }}); return 1'); settle()
s1 = st(); ok('a remote edit applies by id', 'other.1' in s1['ids'] and s1['n'] == 3, s1)
ok('it stays out of your undo and isn’t echoed back', s1['undo'] == 2 and s1['sent'] == 2, s1)

# Undo takes back only your own last edit
js('s.undo(); return 1'); settle()
s2 = st(); ok('undo takes back your last block, not theirs', b not in s2['ids'] and 'other.1' in s2['ids'] and a in s2['ids'], s2)
ok('your undo goes out to the others as an edit', s2['sent'] == 3 and js('return window.__sent[2].set[0][2] === null'), s2)
js('s.redo(); return 1'); settle()
ok('redo puts it back with the same id', b in st()['ids'])

# They remove your first block; undoing your edit that added it is skipped gracefully
js(f'const spec = s.specOf(s.recById.get("{a}")); s.applyRemote({{ set: [["{a}", spec, null]] }}); return 1'); settle()
js('s.undo(); s.undo(); return 1'); settle()
s3 = st(); ok('undo skips a block someone else removed', s3['ids'] == ['other.1'], s3)

# Snapshot round trip keeps ids
state = js('return s.buildState()')
js('s.clearPlaced(); return 1'); js(f's.loadBuildState({__import__("json").dumps(state)}); return 1'); settle()
ok('a room snapshot loads with its ids', st()['ids'] == ['other.1'] and st()['undo'] == 0, st())

# A kit is one undo step
c = place(2, 2); settle()
n_before = st()['n']
js('await s.startKit("7910-1", "Robot"); for (let i = 0; i < 20 && s.kit; i++) s.skipStep(); return 1'); time.sleep(1)
js('s.undo(); return 1'); settle()
ok('undo after a kit brings back the build from before it', st()['n'] == n_before and c in st()['ids'], st()['n'])
js('s.onEdit = null; s.clearPlaced(); return 1')
