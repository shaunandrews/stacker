# 11 · Desktop play & cross-device multiplayer (plan)

Status: **Phases 1 (desktop), 2 (edits and players) and 3 (multiplayer spikes) shipped; rooms v1 (Phase 4) shipped without voice and shared kit paging**, which come next. The goal: keyboard and mouse play that feels native rather than "VR with a cursor", and then online rooms where people on computers and in headsets build on the same plate together. Desktop comes first, built so its actions can go over the network later.

## What we want

From the requirements interview (2026-10-14):

| | |
|---|---|
| Desktop audience | Gamers (Minecraft-literate) and serious builders (LDD / Studio users) |
| Camera | Orbit the build. Trackpad-friendly, Figma-style: two-finger scroll pans, pinch zooms, right-drag or ⌥-drag orbits. No middle-drag dependence |
| Placing | **Brush**: pick a part and it rides the cursor with a snapping ghost; click to place, again and again; right-click or Esc puts it down |
| Parts, colors, finishes | A 2D HUD: parts browser plus a 1–9 hotbar (recent parts, pinnable), color and finish swatches. The 3D shelf stays for VR |
| Power tools (first pass) | Eyedropper (⌥-click or I), marquee select (⇧-drag), copy / paste / duplicate (⌘C ⌘V ⌘D) |
| Rotation keys | R spins 90° (⇧R the other way), T tips; Q/E and the arrows keep working |
| Kits on desktop | The manual in a HUD side panel; the step's pieces fill the hotbar |
| Shared space | One shared platform |
| Rooms | Open: anyone with the link (or the room list) can join; no moderation planned |
| Presence | VR players: head + hands (and their ray). Desktop players: a camera marker where they're looking from, and a colored 3D cursor |
| Conflicts | First grab wins: a held block glows in its holder's color and can't be taken until they let go |
| Comms | Spatial voice chat |
| Undo · kits | Undo takes back only your own actions. Kits are shared: anyone can start one, page it, and build it |

## Where desktop is today

The desktop view (`desktop.ts`, read by `readMouse`) treats the mouse as a VR right hand: a ray from the camera, left-drag carries, ⌥-drag duplicates, ⇧-click selects, Q/E and the arrows turn a held block, Delete deletes, 1/2/3 pick tools, ⌘Z undoes. The camera orbits with right-drag, pans with ⇧+right-drag or middle-drag, and zooms with the wheel. The VR furniture (the parts shelf, jars, wrist menu, kit shelf, manual) sits docked in view and is clicked in 3D. It works, but it's slow (every part is a drag from a 3D shelf), trackpads can't pan comfortably, and there's no hotbar, eyedropper or copy/paste.

## Desktop design

### Controls

| Action | Trackpad | Mouse | Keys |
|---|---|---|---|
| Orbit | ⌥ + two-finger drag, or ⌥-drag | Right-drag | Q / E around, Page Up / Down to tilt (when nothing's held) |
| Pan | Two-finger scroll | ⇧ + right-drag | W A S D (when nothing's held) |
| Zoom | Pinch | Wheel | + / − |
| Focus a block | Double-click it | Double-click it | F frames the whole plate |
| Pick a part | Click it in the browser or hotbar | Same | 1–9 for hotbar slots |
| Place (brush) | Click | Click | Space places at the cursor |
| Put the brush down | Esc | Right-click or Esc | |
| Turn · tip the brush / held block | | | R (⇧R back) · T (⇧T back) |
| Move a placed block | Drag it | Drag it | |
| Eyedropper | ⌥-click a block | ⌥-click | I over a block |
| Select | ⇧-click; ⇧-drag a box | Same | ⌘A all |
| Copy · paste · duplicate | | | ⌘C · ⌘V (pastes onto the brush) · ⌘D |
| Delete | | | Delete / Backspace |
| Undo · redo | | | ⌘Z · ⇧⌘Z |

Notes:
- On a trackpad, the browser reports pinch as a wheel event with `ctrlKey`; two-finger scroll as plain wheel deltas. A mouse wheel is told apart by its large, stepped deltas, which zoom instead of panning (a setting can force either)
- W A S D and Q / E move the camera only while nothing is held, so they never fight R / T

### The brush

1. Picking a part (browser, hotbar, eyedropper or paste) loads the brush: the part, in the current color and finish, rides under the cursor
2. Each frame the cursor's ray finds where it would land: the face of a placed block or the plate under the cursor, then the existing connector snap (`computeSnap`, ranked by how far the piece would move) picks the landing. The ghost shows it; red when there's no valid spot
3. Click places a copy and the brush stays loaded, so you can stamp rows quickly. R / T turn the brush
4. Esc or right-click empties it. Dragging a placed block (no brush) moves it, as today

### HUD (DOM, over the canvas)

The HUD is HTML and CSS layered over the WebGL canvas, hidden in XR. That gives crisp text, real scrolling and search, and quick iteration.

- **Parts browser:** a left drawer with the library tabs, a search field, and a grid of part thumbnails (the catalog's `Thumbnailer` already renders these). Click to load the brush. Collapsible
- **Hotbar:** nine slots along the bottom; parts you use go in from the left, and a pinned slot stays put. 1–9 picks, scrolling over it cycles
- **Color and finish:** a swatch strip by the hotbar; the eyedropper and selection recolor use it too
- **Tool and status:** what's in the brush, the selection count, undo / redo buttons
- **Kit panel:** the manual page (`ManualPainter`, the same renderer the headset and the catalog use) in a right-hand panel with ◀ ▶; the step's remaining pieces fill the hotbar
- **Settings:** the existing settings, plus a Controls sheet for desktop

### Under the hood: edits, not input (shipped)

Instead of instrumenting every way the build can change, Stacker already waits for an edit to **settle** (nothing held or animating) before recording undo. At that moment it diffs the build against the last settled state, keyed by **stable block ids** (`edits.ts`):

```ts
type Spec = string; // "part id|color code|finish id|16 matrix values" (platform-local meters)
interface Edit {
  set: Array<[id: string, from: Spec | null, to: Spec | null]>; // per block: before → after (null: absent)
  bounds?: [from: Bounds, to: Bounds];                          // plate resized
}
```

- Every placed block has an id `${playerId}.${n}`, made where it's created (`makeRec`), kept through recolors and undo
- `settleUndo` computes the edit, pushes it on your undo stack (outside kits) and hands it to `onEdit`, the hook multiplayer listens on
- **Undo is per player:** it applies the inverse of your own last edit by id; blocks someone else has since removed are skipped. Undo and redo go out through `onEdit` too
- `applyRemote(edit)` applies someone else's edit by id and folds it into the settled state, so it never lands in your undo or gets echoed back
- `buildState()` / `loadBuildState()` move the whole build with its ids (a room's join snapshot)
- A kit is still one undo step: the build from before it (`kitBase`) diffed against the build after it
- Grabbing isn't an edit until it settles; "first grab wins" is a separate, immediate lock message (Phase 4)

## Multiplayer: what the spikes found

| Question | Answer |
|---|---|
| **Transport** on Spacefast | Two lanes. **Edits** go through the Zero capsule (`capsule/server`): mutations into a numbered log per room, delivered by live queries in about half a second. **Poses** go through the realtime relay Zero already runs (Cast, Phoenix channels): every page of a published version shares one presence room, and each visitor's presence carries a `tool` string cut to 64 characters. A pose packs into 48 bytes of base64 (`net/pose.ts`). Measured between two browsers: 20 updates a second, all delivered in order, 64–124 ms (average 80 ms) sender to receiver. App sockets (`/api/socket/:name`) are still undocumented, and the relay's other events (`broadcast` and friends) are refused or crash the channel, so presence is the only fast lane today |
| **State model** | A shared log, ordered by the server (`pushEdit` hands out numbers in a transaction). Each player applies the log in order, skipping their own edits (already applied). No host is needed for edits; the room's longest-standing player (the host) only folds the log into a snapshot every 60 entries. When the host leaves, the next player in line takes over |
| **What travels** | Settled edits (`edits.ts`; a burst is merged and sent as one, big ones are split under the 64 KB field limit); poses at up to 20 Hz (head and hands, or camera and cursor, plus the held block); a snapshot plus the log since it when someone joins |
| **Conflicts** | First grab wins: your pose names the block you're holding (a hash of its id). Others can't pick it up or delete it, and see a ghost of it in your color where you hold it. Two players editing the same block at the same moment is still last-write-wins |
| **Voice** | Not yet. Plan: WebRTC audio between each pair, the connection setup passed through the capsule's `signals` table (already there), positioned with Web Audio panners at each player's head or camera. TURN is the open question: Spacefast doesn't offer one, so players behind strict NATs may need a provider |
| **Rooms** | Open rooms keyed by a five-letter code. A `rooms` table with a heartbeat makes the lobby (the HUD's Together panel and the web page `/rooms`). Guests are enough: a chosen name and one of eight colors (stored on the device) |
| **Shared frame** | Everything travels in platform-local coordinates. Each player keeps their own plate pose and scale, and remote heads, hands and cursors map through each one's own plate. Bodies keep their real-world size |
| **Persistence** | A room's build lives in the capsule (snapshot plus log). Your own build is put aside when you join and comes back when you leave; nothing from a room is autosaved over it |

## Rooms v1 (shipped)

- **Together** (desktop HUD, top bar): set your name and color, **Start a room with this build** (your build seeds it), join an open room or a code. In a room: the code, **Copy link**, who's here (and who's host), **Leave room**
- **Links:** `/?room=CODE` joins on load, on a computer or in the headset's browser; `/rooms` lists open rooms
- **Presence:** VR players show a head (with a visor) and two hands; desktop players a camera marker and a ring cursor on the build; everyone has a name tag in their color
- **Locks:** first grab wins (above)
- **Undo** stays per player; kits run locally but their blocks sync like any other edit

How it fits together:

| Piece | Job |
|---|---|
| `capsule/server/index.ts` | Tables `rooms`, `edits`, `snaps`, `members`, `signals`; `pushEdit`, `putSnapshot`, `joinRoom`, `heartbeat`, `leaveRoom`; live queries `openRooms`, `roomLog`, `roomMembers`; `GET /api/rooms/snapshot` |
| `net/zero.ts`, `net/zero-bridge.ts` | Finds the capsule (`/__zero/config`); a hidden Preact tree holds Zero's hooks for plain code. On the dev server there's no capsule, so Together stays hidden |
| `net/cast.ts` | Joins the relay's presence room with a runtime ticket, sends `presence:update` at most 20 Hz (and every 15 s when idle, or presence lapses after 45 s), rejoins when the relay closes the channel |
| `net/pose.ts` | The 48-byte pose |
| `net/room.ts` | The session: join (snapshot + log), send edits, apply others', compact as host, read poses |
| `net/avatars.ts` | Draws other players and their held blocks |

Known limits: one presence room per published version (everyone on the site shares it; packets carry a room hash and are filtered), so very busy sites would want app sockets; two people on different published versions can't see each other's poses; same-block conflicts are last-write-wins.

## Plan

**Phase 1: desktop that feels native** (~1 week)
1. Camera: Figma-style trackpad gestures, mouse fallback, W A S D / Q / E, double-click focus (~1 day)
2. Brush: load, snap preview, click-to-stamp, R / T, Esc (~1–2 days)
3. HUD: parts browser with search, hotbar (recents + pins), swatches, status; hide the VR furniture on desktop (~2 days)
4. Power tools: eyedropper, marquee select, copy / paste / duplicate (~1 day)
5. Kit side panel + step hotbar (~half a day)

**Phase 2: actions and players** (~2–3 days): the action layer, stable block ids, per-player undo, a fake second "player" in tests driving actions.

**Phase 3: multiplayer spikes** (done): transport on Spacefast (above), two browsers sharing a plate, poses at 20 Hz.

**Phase 4: rooms v1:** open rooms, presence, first-grab locks, join snapshots, host hand-off (done); next: spatial voice, shared kit paging, a Together panel in the headset (VR players join by link today).
