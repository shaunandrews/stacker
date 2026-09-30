# 01 · Vision & status

## The idea

A building toy that lives in your room. Passthrough stays on, a platform floats over your desk, and you build with real-feeling bricks using your hands or controllers — without losing track of your coffee.

### Pillars

1. **Tactile first.** Grabbing and placing should feel physical: a magnetic pull in the last centimeter, a click, a haptic tick.
2. **Room-aware.** Mixed reality by default. Everything is a physical object you can move, tilt and resize — no flat HUD.
3. **Magic where it helps.** Hunting for pieces is a chore, so remove it: point-and-pick, duplicate with a button, pieces for each kit step laid out on a shelf.
4. **Simple now, deep later.** Plain bricks first; hinges, wheels, minifigs and functional parts ride on the same systems.

## What exists today

| Area | State |
|---|---|
| Platform | 4–64 studs per side, drag corners to resize, grab any edge to move and tilt, snaps level when released within 7°; small translucent handles that yield to nearby blocks |
| Parts | 300 real parts from the LDraw library: the most-used parts per category (Rebrickable data), a Special tab (SNOT bricks, brackets, hinges, turntables), windows with panes and shutters, and every part the kits use |
| Colors | 32 official LDraw colors plus the kits' extras, including transparents; printed/fixed-color regions (faces, hands) survive recoloring |
| Building | Connector snapping (studs and sockets in any orientation, side studs, free rotation, drop-settle onto studs below), joint mounts (hinge halves, turntables, window glass, panes, shutters), ghost preview of the landing spot |
| Moving parts | Hinges, swivel plates, hinge bricks, turntables, doors, window panes and shutters swing after placing, carrying whatever is built on them |
| Tools | Build, Select (multi-select, group move/duplicate/delete/recolor), Paint (sweep to recolor), undo/redo |
| Kits | Seven official models — House, Go-Kart, Robot, Sea Plane, Turbo Prop, Pizza To Go, Fire Station — on a rack of 3D boxes you pull down, turn over and tear open; built sub-assembly by sub-assembly in the model's own order |
| Guidance | Edge-only pulsing ghosts, a yellow guide line, 6 cm magnet, a parts shelf where the box was opened (big pieces shrunk to fit), restart/skip step, and an optional paged manual drawn like a printed booklet (flat isometric, bold outlines, parts callout, arrows; zoomable) |
| Minifigs | 6 presets that snap as one stacked figure |
| Look | 6 presets; real HDRI environments, baked and contact ambient occlusion, plastic micro-surface, stud logos (a winking smiley); environment, tone and sliders under Advanced; render resolution 1.3×; 3 materials (plastic, wood, clear) |
| Desktop | A mouse-and-keyboard view for exploring and testing without a headset |
| Saves | Autosave and 6 named slots in browser storage |
| Performance | Instanced rendering (one draw per part type), no physics engine, occlusion updated only on edits, foveation, 120 Hz requested |

## How it got here (short history)

1. **Spike:** WebXR + IWSDK with a physics bucket of 300 blocks, to prove the platform could do it.
2. **Feel pass:** smaller blocks, better lighting, custom grab (controller hold offset, pinch-point grabbing), movable platform and bucket.
3. **Performance pass:** removed the bucket and the physics engine, moved placed blocks to instanced batches, added point-to-pick, duplicate, delete, platform handles, resize.
4. **Real parts:** pulled in the LDraw part library and Rebrickable usage data; first kit (House) with generated steps.
5. **Depth pass:** half-plate heights, fixed colors, free-placed parts, minifigs, more kits, shelf, size slider, overhang snapping.
6. **UX pass:** separate library/settings panels, resizable library, look sliders, kit guidance line + magnet, manual instructions.
7. **Connections:** stud connectors instead of a fixed grid, free rotation, joint mounts, swinging hinges; presets instead of loose sliders; desktop view, undo.
8. **Kits as products:** the box rack, four more kits, build order that follows each model's sub-assemblies, booklet-style manual pages.
9. **Rendering pass:** render resolution, real HDRIs, baked + contact occlusion, plastic micro-surface, stud logos.

The original design called for a physics bucket you sift through. It was dropped: at 500 bodies it was janky on Quest, and point-and-pick plus the catalog made it unnecessary. See [08 · Decisions](08-decisions.md).

## What's next (candidates)

- **Tune on device:** fps at Resolution 1.2 / 1.3 / 1.5, the cost of Occlusion under Stress, and whether stud logos or the micro-surface shimmer.
- **Locking hinges** (the Robot's clicking hinges) and a stored swing angle, so stops survive a reload.
- **Better steps for big sets:** the Fire Station's authored steps spread across the whole building; split them by area.
- **More kits:** the converter handles any LDraw OMR model; the bottleneck is choosing good first experiences. Other sources (fan models) need a licence check.
- **Minifig builder:** pick torso/legs/hair/face individually instead of presets.
- **Persistence in the room:** WebXR anchors so the platform and panels return to the same real-world spot.
- **Sharing:** export/import builds as files or links.
- **Store release:** needs a licensing/trademark review first (see [07 · Development](07-development.md#licensing)).
