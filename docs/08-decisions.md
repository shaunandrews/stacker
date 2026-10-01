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

### Presets up front, sliders under Advanced; three materials
The sliders didn't mean much to the player. Six tuned presets are the main choice now; the sliders stay under Advanced for tuning. Twelve finishes became three that matter for building: plastic, wood, and clear plastic for windows.

### Stay on WebXR + three.js for visuals (Sept 2026)
Researched native (Unity, Spatial SDK) and other web stacks (WebGPU three, Babylon, PlayCanvas, Wonderland). The cheap look came from craft, not the platform: no bevels or seams, an environment light drowning the key light, and rendering below native resolution. The web already has dynamic resolution (`XRView.requestViewportScale`) and SpaceWarp behind a flag; WebGPU in WebXR has been experimental, flag-only, since Quest Browser 146 (Apr 2026). Native's only unique gain is lighting from the passthrough cameras, which nobody ships. So: stay, and fix the craft — resolution, real HDRI environments, baked and contact AO, plastic micro-surface, stud logos — without post-processing passes, which don't work in multiview WebXR.

### Desktop view as a virtual right hand
Exploring and testing on a laptop reuses the XR interaction code: the cursor becomes the right hand's ray (mode `mouse`), the left button its trigger. Only carrying differs — a mouse has no depth, so a held block sits on whatever is under the cursor. One interaction model, so desktop tests exercise the same paths as the headset.

### Undo by snapshots, not commands
Snapshotting placed blocks + bounds after each settled edit covers every way the build changes (grabs, paints, deletes, kits ending, Clear, Stress) without instrumenting each one. At 1.5k blocks a snapshot is ~180 KB and ~1 ms, taken only when an edit settles.

### Splash screen before XR
The page used to open straight into a black canvas. A splash (in `index.html`, so it shows before any JS loads) reports loading progress, then offers mixed reality or the desktop view, and returns when you leave XR.

### Bevels baked in the pipeline, not a shader
Edge highlights carry the LEGO look. Chamfering hard edges at build time costs triangles (~1.8×) but no per-pixel work, and works on any LDraw part. Screen-space tricks (SSAO, edge detection) don't fit multiview WebXR.

### Real HDRIs for reflections (Sept 2026)
The procedural environments (gradient spheres and glowing panels) gave plastic flat, fake reflections. Real CC0 HDRIs put believable windows and falloff into every highlight for ~1.5 MB each, loaded only when chosen. 1k is enough — reflections are blurred by roughness anyway — and 2k would be ~6 MB each.

### Occlusion baked per part and voxelized between parts (Sept 2026)
SSAO needs a depth pre-pass and post-processing, which multiview WebXR can't afford. Occlusion splits cleanly instead: inside a part it never changes, so it's baked per vertex in the pipeline (free at runtime, stored in a spare byte); between parts, the build is already a grid of studs and plates, so a small occupancy texture sampled along the normal gives soft Minecraft-style contact shadows, updated only when the build changes.

### A catalog page in the same app, editing through the dev server (Sept 2026)
Auditing parts, colors and kit steps needs the real geometry and the real manual renderer, so the catalog is a second Vite page (`catalog.html`) that imports the app's own modules instead of a separate tool. Edits go through a small dev-server plugin (`catalog-api.ts`, local requests only) that writes the source files in `tools/` and reruns the pipeline, so every change shows in `git diff`; the deployed copy is read-only. Kit step edits are stored as regroupings of model-file indices (`tools/kit-edits/`) rather than hand-edited kit JSON, so rebuilding a kit doesn't lose them.

### Accounts on Spacefast Zero (Sept 2026, planned)
Accounts, friends and sharing will run on the Space's own Zero runtime rather than WordPress or an outside backend: guests come built in (and carry their data into an account on sign-in), live queries cover feeds, and it keeps everything on Spacefast. Stacker talks to it through a small off-screen Preact bridge, since Zero's data API is hooks. Detail and spike results: [10](10-accounts.md).

### A parts shelf instead of a library panel (Sept 2026)
The flat library panel worked but felt like a web page floating in the room. Parts now live in a physical shelf: a six-sided drum of cubbies you spin (a lazy Susan keeps every category one swipe away without a wall of tabs), colors are paint jars you dip into, finishes are sample bricks you touch. Tools, undo and saves moved to a wrist menu (palm up), so nothing else needs a panel; the Kits tab went away because the box rack covers it. Only the faces turned toward you draw their parts, to keep draw calls near the old panel's.

