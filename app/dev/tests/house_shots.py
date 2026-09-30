"""Before/after render shots of a finished House kit: python3 dev/tests/house_shots.py <prefix>"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from hinge_setup import *
prefix = sys.argv[1] if len(sys.argv) > 1 else 'house'
style = int(sys.argv[2]) if len(sys.argv) > 2 else 0
reset()
hjs(f's.applyStyle({style}); await s.startKit("7796-1", "House"); while (s.kit) s.skipStep(); return 1')
time.sleep(2)  # HDRI environments load asynchronously
move('controller-right', [0, 0.5, 0], 0.1); move('controller-left', [0, 0.5, 0], 0.1)
c = hjs('return P(s.placedRecs[0])')
view_local([0.0, 0.16, 0.2], [0.0, 0.03, -0.01], f'{prefix}-wide')
view_local([0.035, 0.07, 0.075], [0.0, 0.025, 0.0], f'{prefix}-close')
view_local([-0.02, 0.04, 0.05], [0.0, 0.012, 0.0], f'{prefix}-macro')
