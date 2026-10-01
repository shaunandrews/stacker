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
│   ├── build-parts.mjs     ← LDraw parts → app/public/parts/parts.{json,bin} (bevels, seams, baked AO)
│   ├── selection.json      ← curated part list (generated, committed)
│   ├── special-parts.json  ← Special/Windows tab parts and joint mounts (hinges, panes, shutters)
│   ├── hinges.json         ← pivot, axis and range for parts that swing
│   ├── kit-parts.json      ← extra parts/colors the kits need (generated)
│   ├── kit-edits/          ← step regroupings saved from the catalog (applied by build-kit.py)
│   └── minifigs.json       ← minifig part overrides, presets, assembly offsets
├── data-src/               ← downloads (LDraw library, Rebrickable CSVs, .mpd models) — not in git
└── app/                    ← the app (an IWSDK project)
    ├── iwsdk.config.json   ← project authority: XR mode, features, scene
    ├── catalog.html        ← the catalog: browse and audit parts, colors, finishes, kits
    ├── catalog-api.ts      ← dev-server API behind the catalog's edits (never in the build)
    ├── src/
    │   ├── index.ts        ← World.create() + registers StackerSystem
    │   ├── stacker-system.ts ← all app behavior (one ECS system)
    │   ├── blocks.ts       ← part library loader, geometry decode (AO, stud-logo UVs), units
    │   ├── look.ts         ← finishes, block shader patch (occlusion, micro-surface, logo), environments, presets
    │   ├── kit-boxes.ts    ← kit boxes (faces, tear strip) and ArtRenderer (box art, manual pages)
    │   ├── kits.ts         ← KITS list, kit block format, kit piece → matrix
    │   ├── manual.ts       ← ManualPainter: draws manual pages (the headset and the catalog)
    │   ├── shelf.ts        ← the parts shelf: six-sided drum of cubbies, paint jars, sample tiles
    │   ├── snap-camera.ts  ← the box camera on the kit rack
    │   ├── lamp.ts         ← the pull-cord lamp
    │   ├── catalog/        ← the catalog page's views, audit checks and viewers
    │   ├── desktop.ts      ← mouse + keyboard input for the desktop view
    │   ├── splash.ts       ← loading progress on the splash screen
    │   ├── components.ts   ← (empty) ECS component manifest
    │   └── assets.ts       ← (empty) asset manifest
    ├── public/
    │   ├── parts/          ← parts.json, parts.bin, colors.json, minifigs.json
    │   ├── kits/           ← one JSON per kit
    │   ├── catalog/review.json ← audit marks from the catalog (✓ / ⚑ + notes)
    │   ├── env/            ← HDRI environments (Poly Haven, CC0)
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
| Rack | kit box rack entity | Boxes on it follow it; a box off the rack is a world-level mesh |

Platform-local units are **real-brick meters** (8 mm stud pitch). World size = local × scale.

### Core data

```ts
interface Placed {           // a block on the platform
  part: number; color: number; finish: number; // part library, palette and finish indices
  m: Matrix4;                          // full transform, platform-local meters (center of the baked part)
  mi?: Matrix4;                        // its inverse, for hit tests
  target?: Placed;                     // kit ghost this placement fills
  swing?: number;                      // radians turned about its hinge since placed
  slot, batch;                         // where it lives in its instanced batch
}
interface Loose { entity; mesh; part; color; finish }   // held, parked, on the shelf, or animating in
```

- `placedRecs: Placed[]` — flat list for hit tests, saves and undo snapshots
- `connIndex` — spatial hash of every placed stud and socket (`indexConns`), what snapping and hinge groups search
- `batches: Map<'part|finish', Batch>` — one `InstancedMesh` per part × finish, color per instance
- `loose: Loose[]` — every free-floating block
- `hands: HandState[2]` — per-hand input, target, and what's being carried, swung, torn or dragged
- `panels: Panel[]` — the wrist menu, settings, and (in manual mode) the kit manual; the parts shelf is its own object (`drum`)
- `kit: KitState | null` — current kit, step, ghosts, matches, shelf contents, manual page and zoom
- `boxes: KitBox[]` — the kit boxes and their state (rack, held, loose, returning, opening)

### Update loop (per frame)

1. Stats (fps, worst frame) every 0.5 s; desktop input and camera
2. For each hand: read input → if carrying pieces, hold / release; if swinging a hinge, a box or a tear strip, update it; if holding a frame (platform, panel, shelf, rack, corner, resize), drag it; else find a target (near first, then ray), handle poke, and dispatch grab / duplicate / delete
3. Handle opacity; snap animations → pieces into their instanced batches
4. Contact occlusion: platform matrix every frame, occupancy grid only when the build changed
5. Box animations (returning to the rack, opening → start the kit); delete "poof" animations
6. Platform level-settle animation; undo settles
7. Spin catalog previews; selection outlines
8. Shadow map redraw only if something moved; debounced autosave (1 s) of the build and look settings

### Where to find things in `stacker-system.ts`

The file is organized in banner sections, in this order: constants & types → build (lights, materials, look settings, environments) → platform → panels (library, settings, drawing, buttons) → connectors (tables, spatial hash, collision) → placed blocks (batches, contact occlusion) → loose blocks & minifig assembly → snapping → input → targeting → actions (grab, duplicate, delete, paint, hinges, hold, release, drag frame/corner/resize) → visuals → kits (ghosts, steps, guidance, manual pages, shelf, kit boxes) → undo → saves → dev (showcase, stress) → helpers (sound, haptics, stats).

## Part library (`blocks.ts`)

- `Library.load()` fetches `parts.json`, `parts.bin`, `colors.json`, `minifigs.json`
- `buildGeometries()` decodes each part: Int16 positions (0.1 LDU) → meters, Int8 normals with baked AO in the 4th byte (`ao` attribute), Uint16 indices, optional RGBA8 fixed colors, and stud-top UVs for the logo (`studUv`, from the part's stud connectors)
- `dims`: `pitch = 0.008`, `unit = 0.0016` (half plate), `ldu = 0.0004`
- `studGeometry()` — the baseplate's own stud, with the same AO and logo UVs
- `isSymmetric(def)` — whether rotation matters when matching kit ghosts
- Materials live in `look.ts`: `makeFinish` + `patchBlockShader` (see [06](06-rendering-and-performance.md))
