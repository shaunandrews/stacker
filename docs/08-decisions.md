# 08 · Decisions

A log of the choices that shaped Stacker, and why. Newest last.

### WebXR + IWSDK instead of Unity
Quest Browser supports everything Stacker needs (passthrough, hand tracking, planes/meshes, anchors, depth). Web meant instant deploys by URL and a fast edit loop. The risk was performance, so the first spike stress-tested 300 physics bodies. Unity stays the fallback if web hits a wall.

### Own interaction instead of IWSDK's grab system
IWSDK's grab picked blocks from the palm, so hand grabs landed wrong, and controller grabs hid the block. Owning input let us grab at the pinch point, float held blocks ahead of the controller, rotate with the thumbstick, and use one code path for single blocks, groups and minifigs.

### No bucket, no physics
The physics bucket was janky at 500 bodies on Quest, and sifting became unnecessary once the catalog, point-and-pick and duplicate existed. Dropping Havok freed CPU and let placed blocks become pure data.

### Placed blocks are data + instanced meshes
One `InstancedMesh` per part keeps draw calls flat no matter how big the build gets. It also made the platform a single parent transform, so moving, tilting and scaling it is free.

### Stud grid snapping, not connector physics
A lattice with an occupancy map covers studs-up building simply and predictably. Hanging under overhangs was added as a second candidate height. Real connectors (side studs, hinges, clips) are future work; kits use free placement for those parts meanwhile.

### Chamfered edges, not rounded (procedural era)
RoundedBox with 1 segment looked the same as 2 at 36% of the triangles. This was superseded when parts moved to LDraw.

### Our own style → LDraw parts
The first custom style (cube bricks, octagonal studs, our palette) avoided looking like LEGO. The user then chose to pull in LDraw and Rebrickable for breadth and real kits. The trade: a much bigger, accurate library, at the cost of a LEGO look that needs a legal review before any public release.

### Half-plate height units
Minifig legs are 5½ plates tall. Counting heights in half plates (4 LDU) lets minifigs share the grid without special cases.

### Free placement for kit parts
Wheels, arms and hinged parts in official models aren't upright on the grid. They're stored as full transforms and placed by ghost magnet, so kits can include anything in the LDraw library.

### Ghost magnet + guide line
Pieces snapped fine within 2 cm, but players couldn't find the spot or match angles. A 6 cm pull that also sets the angle, plus a yellow line to the target, fixed the "can't place minifig / window / robot parts" reports. Kit ghosts always accept their piece, because bounding boxes of special parts overlap on the grid.

### Removed depth occlusion
It cost GPU time on every pixel and the player didn't want it. Performance for 120 Hz mattered more.

### Library and settings as separate panels
Building tools and look/render tuning serve different moments. The library is resizable, so a bigger grid can replace paging.

### Look sliders instead of fixed art direction
Art direction is still open. Exposing every lighting and material parameter live lets it be tuned in the headset, where it actually matters. Winning values become the new defaults.
