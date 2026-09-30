# 04 · Parts pipeline

Parts come from the [LDraw parts library](https://www.ldraw.org) (real brick geometry, CC BY 4.0). Which parts to include comes from [Rebrickable's catalog data](https://rebrickable.com/downloads/) (how often each part appears across real sets). Both are converted offline into a compact binary the app loads at startup.

```
data-src/ (downloads, not in git)
  ldraw/                      LDraw complete library (complete.zip, ~145 MB → 615 MB)
  parts.csv, part_categories.csv, colors.csv, inventories.csv,
  inventory_parts.csv, sets.csv, themes.csv   Rebrickable CSVs
  7796-1.mpd, 6400-1.mpd, 7910-1.mpd           LDraw OMR kit models
        │
        ├── tools/select-parts.py      → tools/selection.json
        ├── tools/build-kit.py collect → tools/kit-parts.json
        ├── tools/build-colors.py      → app/public/parts/colors.json
        ├── tools/build-parts.mjs      → app/public/parts/parts.json + parts.bin
        └── tools/build-kit.py build   → app/public/kits/<id>.json
```

Rebuild everything (from the repo root, after downloading — see [07](07-development.md#rebuilding-the-data)):

```bash
cd data-src && python3 ../tools/select-parts.py && cd ..
python3 tools/build-kit.py collect data-src/7796-1.mpd data-src/6400-1.mpd data-src/7910-1.mpd
python3 tools/build-colors.py
node tools/build-parts.mjs
python3 tools/build-kit.py build data-src/7796-1.mpd House 7796-1
python3 tools/build-kit.py build data-src/6400-1.mpd Go-Kart 6400-1
python3 tools/build-kit.py build data-src/7910-1.mpd Robot 7910-1
```

## 1. Choosing parts (`select-parts.py`)

- Sums each part's quantity across every set inventory (spares excluded)
- Keeps the most-used parts per Rebrickable category, mapped to Stacker tabs:

| Rebrickable category | Tab | Count |
|---|---|---|
| Bricks | Bricks | 20 |
| Plates | Plates | 20 |
| Tiles, Tiles Round and Curved | Tiles | 14 + 8 |
| Bricks Sloped | Slopes | 20 |
| Bricks Curved | Curves | 14 |
| Bricks Round and Cones, Plates Round Curved and Dishes | Round | 12 + 10 |
| Bricks Wedged | Wedges | 10 |
| Windows and Doors | Windows | 10 |

- Skips stickers, printed variants, glass inserts and door frames, and anything missing from LDraw

Plus `tools/special-parts.json` (Special and Windows tab parts with their joints and mounts), `tools/minifigs.json` (9 minifig parts → Minifigs tab) and `tools/kit-parts.json` (every other part the seven kits use → More tab). Total: **300 parts**.

## 2. Colors (`build-colors.py`)

Reads LDraw's `LDConfig.ldr` for a curated list of 30 codes (whites/greys/black, reds, oranges, yellows, tans, browns, greens, blues, lilac, pinks, and 6 transparents), plus any extra codes the kits use. Output: `colors.json` — `{ code, name, hex, alpha }`. The app keys colors by LDraw code everywhere (saves, kits).

## 3. Converting parts (`build-parts.mjs`)

For each part:

1. **Flatten.** Resolve the part's sub-files and primitives recursively (case-insensitive lookup across `parts/`, `parts/s/`, `p/`, `p/48/`, `p/8/`), composing 3×4 transforms.
2. **Winding.** Honor LDraw BFC: `CERTIFY`, `CW`/`CCW`, `INVERTNEXT`, and negative-determinant flips. Uncertified files emit both sides.
3. **Skip hidden detail.** Underside tubes (`stud4*`, `stud3*`, `stud2a*`, `stud6/10/12/16*`) are dropped — roughly halves triangle counts; you rarely see a brick's underside.
   Parts with more than 64 studs (baseplates, big plates) are rebuilt with LDraw's 8-sided studs (`p/8/`).
4. **Colors.** Color 16 (and edge color 24) inherit the main color; anything else is a fixed color baked per vertex.
5. **Footprint & height.** From the bounding box: `w = x-extent / 20`, `d = z-extent / 20` studs; top = 0 unless the part starts above its stud (then the nearest 4 LDU); `h = (bottom − top) / 4` half plates. Overrides from `minifigs.json` pin minifig parts to 2×1 with exact heights.
6. **Axes.** LDraw is −Y up; rotate 180° about X (`y → −y, z → −z`) into three.js axes, and center the geometry on its footprint and height.
7. **Bevel** (`bevel.mjs`). LDraw edges are perfectly sharp, which reads as cheap. Positions are welded, T-junctions split (so edges on both sides of a crease line up), and every hard convex edge (two faces folded past 35°) is chamfered by 0.5 LDU (0.2 mm): each face is inset away from the edge, a strip bridges the gap, and small fills close corners. The strip's normals blend from one face to the other, so one flat strip shades like a rounded edge. Smooth normals use the same 35° crease angle. `BEVEL_STATS=3001,3003 node tools/build-parts.mjs` prints per-part counts.
8. **Seams.** Outer walls at the footprint edge move in 0.3 LDU (0.12 mm; a multiple of the 0.1 LDU storage grid, so both sides round alike), like real bricks (7.8 mm on an 8 mm pitch). Parts with a pinned footprint (minifigs) are left alone.
9. **Pack.** Weld to indexed vertices; quantize.

### `parts.bin` layout (per part, 4-byte aligned)

| Block | Type | Size |
|---|---|---|
| positions | Int16 × 3, units of 0.1 LDU | 6 × vertices (padded) |
| normals | Int8 × 4 (xyz + pad), /127 | 4 × vertices |
| indices | Uint16 | 2 × indices (padded) |
| fixed colors (only if `fixed`) | RGBA8, alpha 255 = fixed | 4 × vertices |

### `parts.json`

```json
{ "id": "3001", "name": "Brick 2 x 4", "tab": "Bricks",
  "w": 4, "d": 2, "h": 6,               // studs X, studs Z, half plates
  "center": [0, 12, 0],                 // baked center in the part's own LDraw coords
  "fixed": false, "overlap": false,     // fixed-color regions; hats/hair don't collide
  "offset": 0, "vertices": 412, "indices": 1236 }
```

Hinged parts get a `hinge: { p, a, r }` (pivot and axis in the baked frame, range in degrees) from `tools/hinges.json`; paired parts get `joint.mounts` from `tools/special-parts.json` (see [03](03-interaction.md#hinges-startswing)).

Current output: 300 parts, ~4.3 MB binary (baseplates are most of the growth), ~1,160 triangles per part on average; a 2×2 brick is 220 → 400 with bevels, most of it stud rims.

## 4. Runtime decode (`blocks.ts`)

- Positions × 0.00004 (0.1 LDU at real brick size); normals / 127
- Fixed-color alpha is inverted on load so **1 = "use the main color"** — geometry without the attribute gets WebGL's default `(0,0,0,1)` and renders normally
- One `BufferGeometry` per part, shared by instanced batches, loose meshes, previews, ghosts and outlines

## Minifigs

`tools/minifigs.json` defines:

- **parts** with overrides: `3815c01` legs (2×1, h 10), `973c01` torso with arms and yellow hands (2×1, h 8), `3626cp01` grin head (2×1, h 6), and six headgear parts marked `overlap`
- **assembly** offsets (LDU, y down, relative to the torso origin): legs +32, torso 0, head −24, headgear −24
- **presets**: Classic, Police, Builder, Astronaut, Cowboy, Kid (legs color, torso color, headgear + color)

At runtime `figurePieces()` turns a preset into four stacked pieces with level offsets derived from those numbers, and carries them as one group. Everything is pinned to a 2×1 footprint centered on the torso, so the head doesn't land half a stud off.
