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
| Platform | 4–64 studs per side, drag corners to resize, grab any edge to move and tilt, snaps level when released within 7° |
| Parts | 177 real parts from the LDraw library, picked by how often they appear in real sets (Rebrickable data) |
| Colors | 32 official LDraw colors including transparents; printed/fixed-color regions (faces, hands) survive recoloring |
| Building | Stud-grid snapping, stacking, hanging under overhangs, 90° turns, ghost preview of the landing spot |
| Tools | Build, Select (multi-select, group move/duplicate/delete/recolor), Paint (sweep to recolor) |
| Kits | House (56 pcs), Go-Kart (29 pcs, with driver), Robot (25 pcs, hinged parts) |
| Guidance | Edge-only pulsing ghosts, a yellow guide line to where the held piece goes, 6 cm magnet, a movable parts shelf, restart/skip step, optional paged manual with a 3D miniature |
| Minifigs | 6 presets that snap as one stacked figure |
| Look | 6 look presets; environment, tone and 13 sliders under Advanced; 3 materials (plastic, wood, clear); bevelled parts; persisted per device |
| Saves | Autosave and 6 named slots in browser storage |
| Performance | Instanced rendering (one draw per part type), no physics engine, foveation, 120 Hz requested |

## How it got here (short history)

1. **Spike:** WebXR + IWSDK with a physics bucket of 300 blocks, to prove the platform could do it.
2. **Feel pass:** smaller blocks, better lighting, custom grab (controller hold offset, pinch-point grabbing), movable platform and bucket.
3. **Performance pass:** removed the bucket and the physics engine, moved placed blocks to instanced batches, added point-to-pick, duplicate, delete, platform handles, resize.
4. **Real parts:** pulled in the LDraw part library and Rebrickable usage data; first kit (House) with generated steps.
5. **Depth pass:** half-plate heights, fixed colors, free-placed parts, minifigs, more kits, shelf, size slider, overhang snapping.
6. **UX pass:** separate library/settings panels, resizable library, look sliders, kit guidance line + magnet, manual instructions.

The original design called for a physics bucket you sift through. It was dropped: at 500 bodies it was janky on Quest, and point-and-pick plus the catalog made it unnecessary. See [08 · Decisions](08-decisions.md).

## What's next (candidates)

- **Art direction:** use the look sliders on device, then bake the chosen values as defaults.
- **Connections beyond studs-up:** side studs (SNOT), hinges and clips as real connectors instead of kit-only free placement.
- **More kits:** the converter handles any LDraw OMR model; the bottleneck is choosing good first experiences.
- **Minifig builder:** pick torso/legs/hair/face individually instead of presets.
- **Undo/redo.**
- **Persistence in the room:** WebXR anchors so the platform and panels return to the same real-world spot.
- **Sharing:** export/import builds as files or links.
- **Store release:** needs a licensing/trademark review first (see [07 · Development](07-development.md#licensing)).
