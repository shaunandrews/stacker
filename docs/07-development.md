# 07 · Development

## Run it

```bash
cd app
npm install
npx iwsdk dev up            # dev server + a managed browser with the Quest 3 emulator (IWER)
```

The port is set in `app/vite.config.ts` (3129, reserved with Port Keeper). `npx iwsdk dev status` lists the LAN URLs; open one on the Quest (same Wi-Fi) and accept the local certificate warning.

Before testing any change:

```bash
npm run typecheck
```

IWSDK specifics worth knowing (full detail in `app/AGENTS.md`):

- `iwsdk.config.json` is the project authority (XR mode, features, scene), not `vite.config.ts`
- Import Three.js from `@iwsdk/core`, never from `three` (addons like `RoundedBoxGeometry` are the exception)
- Create objects with `world.createTransformEntity(...)`, never `scene.add()`

## Test in the emulator

The emulator is driven by the IWSDK CLI (`npx iwsdk xr …`, `npx iwsdk ecs …`, `npx iwsdk browser …`). Stacker adds a dev-only handle, `window.stacker`, so tests can read and call into the app.

Start the server with browser automation enabled:

```bash
npx iwsdk dev up --headless --ai-mode agent --allow-browser-automation
```

Then from `app/`:

| Script | What it does |
|---|---|
| `npx iwsdk browser run dev/probe.mjs` | JSON snapshot: placed/loose counts, bounds, scale, tool, tab, kit state, hands, panel item world positions, shelf, kit targets, look settings |
| `dev/held.mjs` | What the right hand is carrying and where it would snap |
| `dev/js.mjs` | Evaluates `artifacts/js.txt` with `s = window.stacker` |
| `dev/eval.mjs` | Calls `window.stacker[method](...args)` from `artifacts/eval.json` |
| `dev/stress.mjs` | Runs Stress and reports draws/triangles |

Python regression tests (`dev/tests/`, using the `iw.py` helpers — `probe()`, `move()`, `look()`, `btn()`, `tip_at()`, `js()`):

```bash
python3 dev/tests/test_build_tools.py       # grab, duplicate, select, group move, recolor, paint, delete, save/load
python3 dev/tests/test_kits.py              # shelf, ghost magnet, ghost restore, restart, shelf move, free parts, completion
python3 dev/tests/test_panels_guidance.py   # library resize, sliders, toggles, guide line, rough drop, manual paging
```

Tips:

- Headless Chrome caps rAF at 60 fps — the fps readout is only meaningful on the headset
- Controller ray origin ≠ the position `animate-to` sets; tests aim with `look-at` and nudge held blocks by measuring (`carry_to` in the kit tests)
- Browser logs accumulate across reloads — check timestamps before chasing an old error
- Screenshots: `npx iwsdk browser screenshot --output-file artifacts/x.png` (`artifacts/` is git-ignored)

## Deploy (Spacefast)

The space is `spc_faf94500d20b4e979a35db4ede374b64` (recorded in `app/.spacefast/space.json`). It's claimed and private; share it from the Spacefast dashboard.

```bash
cd app
NODE_ENV=production npm run build
cd dist && zip -qr ../../site.zip . -x "*AGENTS.md"
curl -sS -H "x-spacefast-client: agent/direct-api" -H "Authorization: Bearer $SPACEFAST_TOKEN" \
  --form-string "spaceId=spc_faf94500d20b4e979a35db4ede374b64" \
  -F "archive=@../../site.zip" https://api.spacefast.com/v1/publish
```

Or install the CLI (`curl -fsSL https://spacefast.com/install.sh | bash`) and use `sf publish`. Never commit tokens. Agent instructions: <https://spacefast.com/setup.md>.

Notes: unclaimed spaces don't serve `.wasm`/binary files; the claimed space serves `parts.bin` fine.

## Rebuilding the data

Downloads (≈160 MB compressed) go in `data-src/` (git-ignored):

```bash
mkdir -p data-src && cd data-src
for f in parts part_categories colors inventory_parts inventories sets themes; do
  curl -sSL -o $f.csv.gz https://cdn.rebrickable.com/media/downloads/$f.csv.gz && gunzip -f $f.csv.gz
done
curl -sSL -o ldraw-complete.zip https://library.ldraw.org/library/updates/complete.zip && unzip -q ldraw-complete.zip
for s in 7796-1 6400-1 7910-1; do curl -sSL -o $s.mpd https://library.ldraw.org/library/omr/$s.mpd; done
```

Then run the pipeline in [04 · Parts pipeline](04-parts-pipeline.md). Rebrickable allows automated CSV downloads at most once a day; don't scrape its web pages.

### Finding kits

```bash
cd data-src && python3 ../tools/find-kits.py 25 150            # well-covered small sets in the OMR
cd data-src && python3 ../tools/find-kits.py 20 90 'car|kart'   # filter by name
```

The House was found with the default coverage search. The Go-Kart and Robot came from name searches (with coverage relaxed, since free parts don't need to be in `selection.json`). The OMR file URL pattern is `https://library.ldraw.org/library/omr/<set_num>.mpd`.

## Licensing

- **Stacker's code:** GPL-3.0-or-later (`LICENSE`).
- **LDraw parts:** CC BY 4.0 (some older parts CCAL 2.0). Attribution is shown on the library panel and in `app/public/CREDITS.txt`.
- **OMR models** (kits): CCAL 2.0, credited per model.
- **Rebrickable data:** used as reference for part selection; not redistributed.
- **LEGO®** is a trademark of the LEGO Group, which doesn't sponsor or endorse this project. The geometry and kits are recognizably LEGO. Fine for a personal prototype; **get a trademark/design review before any public or store release.**
