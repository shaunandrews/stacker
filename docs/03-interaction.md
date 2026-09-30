# 03 · Interaction

Stacker does its own input handling on top of IWSDK's raw input: controller poses and buttons from `this.input.xr.gamepads`, and hand joints straight from WebXR (`XRFrame.getJointPose`). IWSDK's own grab system, pointer rays and touch pointers are disabled so there's exactly one interaction model.

## Controls cheat sheet

| Action | Controller | Hand |
|---|---|---|
| Grab (near) | Grip or trigger near a block | Pinch (thumb + index) near a block |
| Grab (far) | Point the laser, then grip/trigger | Point, then pinch |
| Press a button / tab / swatch | Point + trigger (or grip) | Poke with index finger, or point + pinch |
| Duplicate what you're pointing at | Hold A / X — carry — let go to place | Hold thumb + middle-finger pinch |
| Delete | B / Y on a block (or while holding) | Drop it on the library panel |
| Turn held block 90° | Thumbstick left / right | Rotate your wrist |
| Push held block out / pull in | Thumbstick up / down | Move your hand |
| Move platform / tilt it | Grab a white edge bar | Pinch an edge bar |
| Resize platform | Grab a yellow corner | Pinch a yellow corner |
| Move a panel or the kit shelf | Grab its white bar underneath | Pinch its bar |
| Resize the library | Grab its yellow corner (bottom-right) | Pinch it |
| Drag a slider | Point + hold trigger, sweep | Touch and slide, or pinch-drag |

Keyboard shortcuts in the desktop/emulator view: **R** recenter, **C** clear, **S** showcase (every part laid out).

## Input model

Each hand has a `HandState`:

- `mode`: `controller`, `hand`, or `none` (switching modes drops what's held)
- `rayOrigin`/`rayDir` from IWSDK's target-ray space
- `point`: the near-grab point — 3.5 cm out along the controller ray, or the midpoint between thumb and index tips
- `down`/`up`: button edges this frame — `squeeze`, `trigger`, `a`, `b` (controllers), `pinch`, `mid` (hands). Pinches use hysteresis (on < 18 mm, off > 35 mm)
- `holdButton`: whichever button started a hold; releasing *that* button ends it (so hold-A-to-duplicate releases on A)

## Targeting

Each frame, if the hand isn't busy, `findTarget` runs **near first, then far**:

- **Near** (within 4 cm for controllers, 2.8 cm for hands): point-to-box distance against every candidate
- **Far** (ray, up to 4 m): ray-vs-box against the same candidates

Candidates: platform edge bars and corners, panel bars and resize handles, the shelf bar, every panel item (buttons, tabs, sliders, swatches, grid cells), loose blocks, and placed blocks. Placed blocks are tested in platform space where they're axis-aligned boxes (free-placed ones via their inverse matrix). A panel's surface blocks rays to anything behind it.

The target gets a white shell outline (tinted with the paint color in Paint mode). A thin laser and cursor show only when pointing far.

## Carrying blocks

A carry is a list of **pieces**; `pieces[0]` is the anchor. Every other piece stores its offset from the anchor (`offPos`/`offQuat` for display; `d2x`, `d2z`, `dl` in grid terms for snapping). A single block is just a one-piece carry, so groups and minifigs use the same code.

- **Controllers** hold the anchor upright and aligned with the platform, `holdDist` (8 cm default) out along the ray, so the controller never hides it. Yaw is `holdYaw` (thumbstick steps in 90°, smoothed).
- **Hands** keep the grip where it was taken (far grabs fly to the pinch point) and follow the wrist's full rotation, smoothed harder than controllers to hide tracking jitter.
- Grabbing a placed block removes it from its batch and spawns a loose mesh at the same pose.

## Snapping (`computeSnap`)

Given the carried pieces, find where they'd land. The result is one `Placement` per piece; the preview ghost (light blue) is drawn there each frame, and releasing animates the pieces into those spots over 70 ms.

1. **Kit magnet.** If a kit is active and you're carrying one piece, the nearest unfilled ghost of the same part and color within **6 cm** wins outright — including its exact position and angle (free placement).
2. **Bounds.** The anchor must be over the plate (± 2 cm).
3. **Yaw.** The anchor's yaw relative to the platform is rounded to the nearest 90°; the delta from its original turns rotates the whole group's offsets.
4. **Footprint.** Anchor cell = `round(local / pitch − footprint / 2)`. Single blocks are clamped onto the plate; groups must fit entirely.
5. **Height.** Two candidates from the held height `base`:
   - *Resting*: nudge up out of any collision (≤ 6 steps), then drop while the layer below is free
   - *Hanging*: rise until the piece's top touches the underside of something (≤ 12 steps)
   Whichever is closer to where you're holding wins, if it's within 5 cm.
6. Hats and hair (`overlap` parts) and free-placed parts don't take grid cells.

Heights are counted in **half plates** (4 LDU): plate = 2, brick = 6, minifig legs = 10.

## Releasing

- Over the **library panel** → the pieces poof (deleted).
- If `computeSnap` succeeds → cells are reserved immediately (so the other hand can't take them mid-animation), the pieces animate in, then move into their instanced batch, and the kit checks for a match.
- Otherwise they stay **parked** in the air where you let go.

## Tools

| Tool | Trigger/pinch on a block | Grip on a block | A / X | B / Y |
|---|---|---|---|---|
| **Build** | grab | grab | duplicate & carry | delete |
| **Select** | toggle selection (cyan outline) | grab the whole selection | duplicate the selection | delete the selection |
| **Paint** | recolor; keep holding and sweep to paint more | recolor / sweep | duplicate | delete |

In any tool, grabbing a selected block carries the whole selection, keeping its shape and re-selecting it once placed. Tapping a swatch while blocks are selected recolors them.

## Platform, panels, shelf

- **Edge bars** attach the platform rigidly to your hand (6DoF), so you can move and tilt it. If released within 7° of level, it eases back to level.
- **Corner handles** move two edges in whole studs, 4–64 per side, never shrinking past what's built. The opposite corner stays put.
- **Size slider** scales the platform (and loose blocks) around the plate center, 0.75×–3×. Handles counter-scale so they stay the same size in your hand.
- **Library** — bar to move; yellow corner to resize (top-left stays fixed, 0.26–0.9 m wide, 0.3–0.9 m tall). Layout reflows: tabs wrap, the grid gains/loses columns and rows, colors wrap.
- **Settings** — bar to move. See [06](06-rendering-and-performance.md).
- **Kit shelf / manual** — bars to move. See [05](05-kits.md).

## Library panel

Top to bottom: tool row, tabs (Bricks, Plates, Tiles, Slopes, Curves, Round, Wedges, Windows, Minifigs, More, Kits, Saves), the part grid, a context row, the color swatches, credits.

- Grid cells show a spinning preview. **Grab** a cell to pull out a new block; **tap** it to drop one in front of the platform.
- The context row changes with the tab: paging (◀ Tab n/N ▶), kit controls (Exit / ↺ Restart step / Skip ▶), or saves (Save / Slot n / Load).
- Minifigs tab: 6 presets. Grabbing one carries legs + torso + head + headgear as one stacked group.
