---
name: stacker
description: How to work on Stacker (mixed-reality brick building for Quest 3, WebXR/IWSDK) — repo layout, the dev and emulator-test loop, the data pipeline, git commit and push conventions, and building and deploying to Spacefast. Use for any change to this repo, when committing or pushing, or when asked to build, deploy, publish, or ship Stacker.
---

# Working on Stacker

Stacker lives at the repo root with three parts:

| Path | What |
|---|---|
| `app/` | The app: an IWSDK (WebXR + Three.js) project. Nearly all behavior is in `app/src/stacker-system.ts`; parts loading in `blocks.ts`; styles, finishes and environments in `look.ts` |
| `tools/` | Offline data pipeline: LDraw + Rebrickable → `app/public/parts/*`, LDraw models → `app/public/kits/*` |
| `docs/` | Detailed docs — read `docs/README.md` first; `02-architecture.md` and `03-interaction.md` before touching the system |

`data-src/` holds the downloaded LDraw library and Rebrickable CSVs (~900 MB). It is git-ignored; rebuild it with the commands in `docs/07-development.md` only when regenerating parts or kits.

Also read `app/AGENTS.md` (IWSDK's rules): import Three from `@iwsdk/core`, create objects with `world.createTransformEntity`, `iwsdk.config.json` is the project authority.

## Dev loop

```bash
cd app
npm run typecheck                      # always, before testing anything
npx iwsdk dev up --headless --ai-mode agent --allow-browser-automation
```

- Port 3129 (Port Keeper). `npx iwsdk dev status` shows LAN URLs for testing on a Quest.
- Changing `iwsdk.config.json` restarts Vite; wait for `browserCommandReady`.
- Enter XR in the emulator: `npx iwsdk xr enter`. Headless Chrome caps at 60 fps — only trust fps on the headset.

### Emulator checks (run from `app/`)

- `npx iwsdk browser run dev/probe.mjs` — JSON snapshot of app state (placed blocks, kit, hands, panel item positions)
- `dev/tests/iw.py` helpers: `probe()`, `js(code)` (runs with `s = window.stacker`), `move()`, `look()`, `btn()`, `tip_at()`, `tab_id(name)`
- Regression tests — run the relevant ones before committing behavior changes:
  - `python3 dev/tests/test_build_tools.py` (grab, duplicate, select, group move, recolor, paint, delete, save/load)
  - `python3 dev/tests/test_kits.py`, `python3 dev/tests/test_panels_guidance.py`
- Quick kit check: `js('await s.startKit("7796-1","House"); ...skipStep()')` until done, then confirm the piece count (House 56, Go-Kart 29, Robot 25)
- Screenshots: `npx iwsdk browser screenshot --output-file artifacts/x.png`; tile several with `dev/contact.mjs` (reads `artifacts/sheet.json`). `artifacts/` is git-ignored.
- Browser logs accumulate across reloads — compare timestamps before chasing an error.

### Data pipeline (only when parts, colors or kits change)

```bash
python3 tools/build-kit.py collect data-src/*.mpd
python3 tools/build-colors.py
node tools/build-parts.mjs
python3 tools/build-kit.py build data-src/<set>.mpd <Title> <set>
```

Then add new kits to `KITS` in `stacker-system.ts`. See `docs/04-parts-pipeline.md` and `docs/05-kits.md`.

## Git

- Remote: `origin` → https://github.com/shaunandrews/stacker (**public**, GPL-3.0-or-later). Branch `main`.
- Commit only when Shaun asks. Group changes into logical commits; typecheck and run the relevant emulator tests first.
- Message: imperative subject under ~60 chars, blank line, a short body of what changed and why (bullets are fine). End with the attribution line from the current session's instructions (e.g. `Co-Authored-By: Claude …`).
- Never commit: `data-src/`, `app/dist/`, `app/artifacts/`, `app/.spacefast/state.json`, tokens or preview links containing `/__/` keys.
- It's a public repo: check new files for secrets before staging (`git add --dry-run .`).
- Push with `git push` after committing when Shaun asks to push or ship.
- Keep `docs/` current when behavior changes: interaction → `03`, pipeline → `04`, kits → `05`, rendering → `06`, and add a line to `08-decisions.md` for any real design choice.

## Deploy to Spacefast

The app is a static site. The space is `spc_faf94500d20b4e979a35db4ede374b64` (recorded in `app/.spacefast/space.json`; claimed, private).

1. Build:
   ```bash
   cd app && npm run typecheck && NODE_ENV=production npm run build
   ```
2. Package `dist/` (exclude IWSDK's agent files):
   ```bash
   cd dist && rm -f ../../site.zip && zip -qr ../../site.zip . -x "*AGENTS.md" && cd ..
   ```
3. Publish a new version to the existing space — **never create a new space**:
   ```bash
   curl -q -sS -H "x-spacefast-client: agent/direct-api" -H "Authorization: Bearer $SPACEFAST_TOKEN" \
     --form-string "spaceId=spc_faf94500d20b4e979a35db4ede374b64" \
     -F "archive=@../site.zip" https://api.spacefast.com/v1/publish
   ```
4. Read the receipt: `data.version.status` should be `ready` and `data.activation.outcome` `activated`. If `data.next.action` isn't `done`, follow it (see https://spacefast.com/setup.md). `hostname_attach_pending` is informational.
5. Tell Shaun it's live at the same link and to reload on the Quest.

**Token:** `SPACEFAST_TOKEN` must be an account token for the space. Never print it, paste it, write it into the repo, or put it in a command literal. If none is available in the environment, ask Shaun to set it, or use the CLI (`curl -fsSL https://spacefast.com/install.sh | bash`, then `sf setup agent` and `sf publish` from `app/dist`). Agent instructions: https://spacefast.com/setup.md.

Claimed spaces serve binary files (`parts.bin`); unclaimed spaces don't.

## Conventions worth keeping

- Placed blocks are data (matrix + part + color + finish) rendered by instanced batches keyed `part|finish` — don't make per-block ECS entities.
- Snapping is connector-based (`computeSnap`): studs/sockets from `parts.json` `conn`, spatial hash, oriented-box collision. Kits add a ghost magnet on top.
- Look is data-driven: add styles, finishes and environments in `look.ts`, not ad-hoc in the system.
- No per-frame allocation in hot paths; performance target is 120 Hz on Quest 3 (`docs/06-rendering-and-performance.md`).
- Shaun reviews visually: send screenshots (or a contact sheet) for anything that changes the look.
