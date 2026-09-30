# 02 · Architecture

## Stack

| Layer | Choice |
|---|---|
| Platform | WebXR `immersive-ar` session in Meta Quest Browser (passthrough) |
| Framework | [Meta Immersive Web SDK (IWSDK)](https://iwsdk.dev) 1.0 — Three.js (`super-three` 0.181) + an ECS |
| Language / build | TypeScript, Vite (driven by the IWSDK CLI) |
| Data | LDraw part library + Rebrickable CSVs, converted offline by `tools/` |
| Hosting | Spacefast (static upload of `app/dist`) |

IWSDK is used for the XR session, input sampling (controllers, hand joints), the render loop, environment lighting (IBL) and the emulator. Its grab, physics, pointer-ray, spatial-UI and scene-understanding features are **turned off** — Stacker implements its own interaction (see [08 · Decisions](08-decisions.md)).

## Repository layout

```
stacker/
├── docs/                   ← you are here
├── tools/                  ← offline data pipeline (Python + Node)
│   ├── select-parts.py     ← ranks parts by real-set usage → selection.json
│   ├── build-colors.py     ← LDraw color table → app/public/parts/colors.json
│   ├── build-kit.py        ← `collect` kit parts; `build` LDraw model → kit JSON
│   ├── find-kits.py        ← find small, well-covered sets in the LDraw OMR
│   ├── build-parts.mjs     ← LDraw parts → app/public/parts/parts.{json,bin}
│   ├── selection.json      ← curated part list (generated, committed)
│   ├── kit-parts.json      ← extra parts/colors the kits need (generated)
│   └── minifigs.json       ← minifig part overrides, presets, assembly offsets
├── data-src/               ← downloads (LDraw library, Rebrickable CSVs, .mpd models) — not in git
└── app/                    ← the app (an IWSDK project)
    ├── iwsdk.config.json   ← project authority: XR mode, features, scene
    ├── src/
    │   ├── index.ts        ← World.create() + registers StackerSystem
    │   ├── stacker-system.ts ← all app behavior (one ECS system)
    │   ├── blocks.ts       ← part library loader, geometry, materials, units
    │   ├── components.ts   ← (empty) ECS component manifest
    │   └── assets.ts       ← (empty) asset manifest
    ├── public/
    │   ├── parts/          ← parts.json, parts.bin, colors.json, minifigs.json
    │   ├── kits/           ← one JSON per kit
    │   ├── scenes/main.iwsdk.scene.json ← only the IBL "room" environment
    │   └── CREDITS.txt
    ├── dev/                ← emulator probes and Python regression tests
    ├── AGENTS.md / CLAUDE.md ← IWSDK's guidance for coding agents
    └── .spacefast/space.json ← which Spacefast space to publish to
```

## Runtime structure

Everything interactive lives in one ECS system, `StackerSystem` (`app/src/stacker-system.ts`). Blocks, panels and kits are **plain data** rather than ECS components — this lets a thousand placed blocks render as a handful of instanced meshes and keeps hit-testing cheap. IWSDK entities are still used as scene-graph wrappers (`world.createTransformEntity`) for every visible object.

### Frames

| Frame | Object | Notes |
|---|---|---|
| World | XR `local-floor` space | Player origin at the floor |
| Platform | `root` entity (`Platform`) | Origin = stud-lattice origin, plate top at y = 0. Uniformly scaled by the Size slider. Placed blocks, kit ghosts, plate and handles are its children, so moving/tilting/scaling the platform moves everything on it for free |
| Panel | each panel's holder entity | Face is the XY plane, +Z toward the user, origin at the panel center |
| Shelf | shelf tray entity | Tray top is the XZ plane at y = 0 |

Platform-local units are **real-brick meters** (8 mm stud pitch). World size = local × scale.

### Core data

```ts
interface Placed {           // a block on the platform
  part: number; color: number;         // indices into the part library / palette
  i, j: number;                        // stud-lattice cell of the footprint's min corner
  level: number;                       // height in half plates (4 LDU)
  turns: number;                       // 0..3 × 90° about platform up
  fw, fd: number;                      // footprint after rotation
  m?: Matrix4;                         // free placement (kit parts that aren't on the grid)
  slot, batch;                         // where it lives in its instanced batch
}
interface Loose { entity; mesh; part; color }   // held, parked, on the shelf, or animating in
```

- `placedRecs: Placed[]` — flat list for hit tests and saves
- `occupancy: Map<cellKey, Placed>` — which grid cells are taken; key packs `(level, j, i)`
- `batches: Map<'part|o' | 'part|t', Batch>` — one `InstancedMesh` per part × opaque/transparent
- `loose: Loose[]` — every free-floating block
- `hands: HandState[2]` — per-hand input, target, and what's being carried
- `panels: Panel[]` — library, settings, and (in manual mode) the kit manual
- `kit: KitState | null` — current kit, step, ghosts, matches, shelf contents

### Update loop (per frame)

1. Stats (fps, worst frame) every 0.5 s
2. For each hand: read input → if carrying, update the hold / release; if holding a frame (platform, panel, shelf, corner, resize), drag it; else find a target (near first, then ray), handle poke, and dispatch grab / duplicate / delete
3. Snap animations → hand pieces to their instanced batches
4. Delete "poof" animations
5. Platform level-settle animation
6. Spin catalog previews and the manual miniature
7. Selection outlines
8. Debounced autosave (1 s) of the build and the look settings

### Where to find things in `stacker-system.ts`

The file is organized in banner sections, in this order: constants & types → build (lights, materials, look settings) → platform → panels (library, settings, drawing, buttons) → placed blocks (grid, batches) → loose blocks & minifig assembly → snapping → input → targeting → actions (grab, duplicate, delete, paint, hold, release, drag frame/corner/resize) → visuals → kits (ghosts, steps, guidance, manual, shelf) → saves → dev (showcase, stress) → helpers (sound, haptics, stats).

## Part library (`blocks.ts`)

- `Library.load()` fetches `parts.json`, `parts.bin`, `colors.json`, `minifigs.json`
- `buildGeometries()` decodes each part: Int16 positions (0.1 LDU) → meters, Int8 normals, Uint16 indices, optional RGBA8 fixed colors
- `dims`: `pitch = 0.008`, `unit = 0.0016` (half plate), `ldu = 0.0004`
- `blockMaterial(physical, color, trans)` + `withFixedColors()` shader patch (see [06](06-rendering-and-performance.md))
- `isSymmetric(def)` — whether rotation matters when matching kit ghosts
