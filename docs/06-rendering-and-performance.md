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
| **Render resolution** 1.3× by default, set before each session (Resolution slider) — the main sharpness lever; trade it against fps on the headset | `init`, `applyVisuals` |
| **Static shadows** — the shadow map redraws only on change | `update`, `fitShadow` |
| **120 Hz requested** when supported; the Hz button cycles rates | `onSessionStart` |
| Unused IWSDK features off: physics, grabbing, scene understanding, spatial UI, depth sensing, plane/mesh detection, anchors | `iwsdk.config.json` |
| No per-frame allocation in hot paths (shared temp vectors) | throughout |
| Stats strip: fps (green at ≥ 95% of target), worst frame, draw calls, triangles, piece count | settings panel |
| **UI**: a panel item's canvas is redrawn and re-uploaded only when what it shows changes (`sig`); the 32 color swatches are two instanced meshes; layout rebuilds dispose what they made (`Panel.owned`) — `entity.destroy()` alone leaks GPU buffers | `drawUi`, `layoutLibrary`, `clearPanel` |
| **Targeting** skips the per-block pass when the hand's point or ray misses the build's bounds; `rayBox` allocates nothing | `collectTargets`, `buildBox` |
| **Snapping** is recomputed only when the held pieces move (0.5 mm / 0.6°) or the build changes; release commits the cached result | `holdPieces` |

**Stress** (settings → Advanced) tiles the plate with 2×2 bricks six layers deep as a repeatable perf test.

Depth occlusion (real hands hiding virtual blocks) was removed — it cost GPU time on every fragment and wasn't wanted.

## Materials

Three finishes (`FINISHES` in `look.ts`), each one material per palette color for loose/held/catalog blocks, and one white material per finish shared by all instanced batches (tinted by instance color). All are `MeshStandardMaterial`, patched in `patchBlockShader`:

| Finish | Setup | Shader patch |
|---|---|---|
| **Plastic** | roughness 0.25, F0 0.04 (ABS is a single dielectric layer — no clearcoat) | Micro-surface: value noise in the part's own mm (≈1.4 mm features, offset per instance) varies roughness ±0.03 and bumps the normal ~20 µm (screen-space, like three's bump map), fading out below pixel size so studs don't shimmer. Per instance (`gl_InstanceID` hash): ±1.5% value, a touch of hue, ±0.03 roughness — identical bricks aren't clones. A faint self-colored glow (color² × 0.035, less where occluded) for light through ABS |
| **Wood** | roughness 0.62 | Procedural grain in the part's own space (mm): rings around an off-block trunk along X, warped by value noise, plus faint fibres. Palette color stains it (55%). Placed blocks get their own grain from their platform position |
| **Clear** | roughness 0.04, opacity 0.45, no depth write, no shadows | Premultiplied alpha so reflections stay at full strength while the body fades; edges turn more opaque at grazing angles (Fresnel) |

- See-through palette colors always render as Clear. Older saves' glass/frosted/diamond map to Clear, everything else to Plastic
- **Fixed colors:** a per-vertex `fixedColor` attribute — alpha 1 (or no attribute) means use the main color, alpha 0 means use the baked color. This is how printed faces and yellow minifig hands survive recoloring
- Specular anti-aliasing is built into three (derivative-based `geometryRoughness`)
- Panels use unlit materials so the UI looks the same under any lighting

### Stud logo

Every stud top carries a tiny embossed winking smiley (generic on purpose — the repo is public). It's a 128² height map (`makeLogo` in `look.ts`), bumped in the plastic shader like the micro-surface, never geometry (LDraw's `stud-logo` primitives cost triangles). UVs across each stud top (0–1 over the 12 LDU disc; out of range elsewhere) are computed at load from the part's stud connectors (`studUvs` in `blocks.ts`), and set directly on the plate's stud geometry. Mipmaps plus a fade by `fwidth(uv)` stop it shimmering at a distance.

## Geometry

Parts are bevelled in the pipeline (0.2 mm chamfer on hard convex edges, normals blended across the strip so it shades round) with 0.1 mm seams between neighbours — see [04](04-parts-pipeline.md). Baseplate studs use a matching 80-triangle stud with a rounded rim (`studGeometry`).

## Ambient occlusion

- **Baked, per part** (`bakeAO` in `build-parts.mjs`): each vertex casts 24 cosine-weighted rays up to 12 LDU against the part's own triangles (uniform grid, ~17 s for all parts); closer hits darken more. Stored in the spare 4th byte of each packed normal, so `parts.bin` doesn't grow. Darkens stud bases, bevel creases and hollows. Plate studs carry the same at their foot (`studGeometry`)
- **Contact, between blocks** (`updateContact`): an R8 `Data3DTexture` over the plate, one texel per stud cell × plate height (≤ 64 × 128 × 64), with every placed block's collision box rasterized into it. Rebuilt only when the build or plate changes (`editGen`/`platformGen`), never per frame; the platform's world→local matrix is the only per-frame update. Placed blocks (the uncolored batch materials) and the plate sample it 4.5, 8.5 and 13.5 mm out along the surface normal (trilinear) — starting half a cell out so a block never darkens itself — for soft darkening where blocks meet, at wall bases and under overhangs. Loose, held, catalog, box-art and manual materials don't (`STACKER_CONTACT` define)
- **Occlusion** slider (Advanced, 0–2, default 1) scales both
- **Applied** in `patchBlockShader`: indirect diffuse × (1 − ao), indirect specular × (1 − 0.8 ao), direct diffuse × (1 − 0.5 ao), scaled by the shared `OCCLUSION` uniform

## Lighting

- **Environment:** real HDRIs from Poly Haven (CC0, 1k `.hdr`, ~1.5 MB each, in `app/public/env/`): Interior (`photo_studio_loft_hall`), Studio (`studio_small_09`), Daylight (`kloofendal_48d_partly_cloudy_puresky`), Sunset (`venice_sunset`). Loaded with `HDRLoader` only when chosen, PMREM'd once (`fromEquirectangular`) and cached; the procedural scene of the same id (`makeEnvScene`) shows until the file is in. Night and Overcast stay procedural. Older saves' `room` maps to Interior. Its strength is `scene.environmentIntensity` — three ignores `material.envMapIntensity` when the map comes from `scene.environment`, so that's the only dial that works. Keep it well below the key light (0.45–0.7): at 0.9+ it floods every face equally and the build reads flat, with invisible shadows
- **Key light:** one `DirectionalLight`, orbiting the plate center by azimuth/height and following the platform
- **Shadows:** PCF. The shadow camera is fitted to the plate each time the light or plate changes (`fitShadow`), and the map is sized so the chosen softness is ≤ 4 texels of blur (512–2048²). `shadowMap.autoUpdate` is off: the map redraws only after a change, or while something is held, snapping or being dropped
- **Fill:** `HemisphereLight`
- **Tone mapping:** per preset (Neutral, ACES, AgX); applied inline in XR, no extra pass

## Look presets & Advanced

Six presets (`STYLES` in `look.ts`) set environment, backdrop, lights, shadows, tone and plate together: **Daylight** (default), **Soft**, **Golden Hour**, **Studio**, **Showroom**, **Moonlight**. The settings panel shows the presets and the Size slider; **Advanced** expands it with environment, tone, reset and the sliders below. Everything persists per device in `localStorage['stacker.look']` (versioned; older saves reset to Daylight).

| Slider | Range | Drives |
|---|---|---|
| Size | 0.75–3× | Platform + loose block scale |
| Room ↔ virtual | 0–1 | Backdrop dome opacity (0 = passthrough) |
| Reflections | 0–3 | `scene.environmentIntensity` |
| Reflection turn | 0–360° | `scene.environmentRotation` |
| Exposure | 0.3–2.5 | `renderer.toneMappingExposure` |
| Key light / angle / height / warmth | | Directional light |
| Fill light | 0–2 | Hemisphere intensity |
| Shadows | 0–1 | `shadow.intensity`; 0 turns shadows off |
| Shadow softness | 0–6 | Penumbra width (≈1.2 mm per step) |
| Plate brightness | 0.2–1.6 | Baseplate color multiplier |
| Foveation | 0–1 | `renderer.xr.setFoveation` |
| Resolution | 0.8–1.6× (default 1.3) | `renderer.xr.setFramebufferScaleFactor` — applies on the next XR entry (WebXR only reads it when a session starts). IWSDK never sets it, so without this Quest Browser renders below the panel's native 2064×2208 per eye. The session start logs the native factor |

## Perf budget notes

- Triangles: ~760 per part on average after bevels (was ~420); LDraw studs are 16-sided and their rims are most of the bevel cost. Stress (1,536 2×2 bricks) is ~700k triangles per frame with multiview. If big builds get heavy, the next lever is a lower-poly stud primitive at conversion time.
- The shadow pass only runs after a change or while something moves, so idle frames draw geometry once.
- MSAA is on (IWSDK default); foveation is the main fill-rate lever.
