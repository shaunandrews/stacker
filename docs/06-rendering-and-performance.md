# 06 · Rendering & performance

Target: **120 Hz on Quest 3** where possible (72/90 fallback), with builds of 1,000+ pieces.

## What makes it fast

| Technique | Where |
|---|---|
| **Instanced batches** — every placed block of the same part (and opacity) is one `InstancedMesh`; color is per-instance. ~1,150 blocks ≈ 90 draw calls including shadows | `batchFor`, `writeInstance` |
| Batches grow by doubling; removal is swap-with-last | `createBatch`, `removePlaced` |
| **Platform as a parent** — moving/tilting/scaling the platform is one transform, not per-block work | `root` entity |
| **No physics engine** — snapping is a grid lookup (`occupancy` map), not simulation | `computeSnap` |
| **Cheap hit tests** — placed blocks are axis-aligned boxes in platform space | `collectTargets` |
| **Trimmed geometry** — underside tubes removed at conversion | `build-parts.mjs` |
| **Plate studs** are one `InstancedMesh` (up to 64 × 64) | `updatePlate` |
| **Foveated rendering** on session start (slider, default 1 = max) | `onSessionStart`, `applyVisuals` |
| **120 Hz requested** when supported; the Hz button cycles rates | `onSessionStart` |
| Unused IWSDK features off: physics, grabbing, scene understanding, spatial UI, depth sensing, plane/mesh detection, anchors | `iwsdk.config.json` |
| No per-frame allocation in hot paths (shared temp vectors) | throughout |
| Stats strip: fps (green at ≥ 95% of target), worst frame, draw calls, triangles, piece count | settings panel |

**Stress** (settings) tiles the plate with 2×2 bricks six layers deep as a repeatable perf test.

Depth occlusion (real hands hiding virtual blocks) was removed — it cost GPU time on every fragment and wasn't wanted.

## Materials

- One material per palette color for loose/held/catalog blocks; one white opaque + one white transparent material shared by all instanced batches (tinted by instance color)
- **Standard** (`MeshStandardMaterial`) by default; **Physical** (`MeshPhysicalMaterial`, clearcoat) via the Material toggle, or automatically when Clearcoat is raised above 0. Switching swaps every block material
- **Fixed colors:** `withFixedColors()` patches the shader to mix in a per-vertex `fixedColor` attribute — alpha 1 (or no attribute) means use the main color, alpha 0 means use the baked color. This is how printed faces and yellow minifig hands survive recoloring
- Transparent parts: roughness capped at 0.15, opacity from See-through, no depth write, no shadow casting
- Panels use unlit materials so the UI looks the same under any lighting setting

## Lighting

- **Environment:** IWSDK `IBLTexture` with the built-in "room" environment (scene JSON) — gives blocks something to reflect. Background stays empty for passthrough
- **Key light:** one `DirectionalLight` with a 1024² PCF shadow map, orbiting the plate center by azimuth/height, following the platform
- **Fill:** `HemisphereLight`
- **Tone mapping:** Neutral by default (keeps saturated plastic from blowing out); ACES, AgX or None via the Tone button

## Look & render settings

All live, persisted per device in `localStorage['stacker.visual']`. **Reset look** restores defaults.

| Slider | Range | Default | Drives |
|---|---|---|---|
| Size | 0.75–3× | 1× | Platform + loose block scale |
| Exposure | 0.3–2.5 | 1.05 | `renderer.toneMappingExposure` |
| Key light | 0–6 | 2.4 | Directional light intensity |
| Key angle | −180–180° | −40° | Light azimuth around the plate |
| Key height | 5–90° | 55° | Light elevation |
| Key warmth | cool ↔ warm | warm 30% | Light color |
| Fill light | 0–2 | 0.35 | Hemisphere intensity |
| Reflections | 0–3 | 1 | `envMapIntensity` (blocks and plate) |
| Reflection turn | 0–360° | 0° | `scene.environmentRotation` |
| Roughness | 0–1 | 0.3 | Block roughness |
| Metalness | 0–1 | 0 | Block metalness |
| Clearcoat* | 0–1 | 0 | Physical clearcoat (switches to Physical) |
| Coat roughness* | 0–1 | 0.1 | Physical clearcoat roughness |
| See-through | 0.1–1 | 0.5 | Transparent part opacity |
| Plate brightness | 0.2–1.6 | 1 | Baseplate color multiplier |
| Plate roughness | 0–1 | 0.5 | Baseplate roughness |
| Shadow strength | 0–1 | 0.8 | `shadow.intensity`; 0 turns shadows off entirely |
| Shadow softness | 0–6 | 1 | `shadow.radius` |
| Foveation | 0–1 | 1 | `renderer.xr.setFoveation` |

Toggles: **Tone** (Neutral / ACES / AgX / None), **Material** (Standard / Physical), **Guide** (Ghosts / Manual / Both).

## Perf budget notes

- Triangles: ~430 per part on average; LDraw studs are 16-sided. If big builds get heavy, the next lever is a lower-poly stud primitive at conversion time.
- Shadows roughly double geometry cost (shadow pass). Shadow strength 0 is the quickest way to test headroom.
- MSAA is on (IWSDK default); foveation is the main fill-rate lever.
