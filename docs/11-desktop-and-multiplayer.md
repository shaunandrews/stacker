# 11 · Desktop play & cross-device multiplayer (plan)

Status: **Phase 1 (desktop) shipped**; phases 2–4 in progress. The goal: keyboard and mouse play that feels native rather than "VR with a cursor", and then online rooms where people on computers and in headsets build on the same plate together. Desktop comes first, built so its actions can go over the network later.

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

### Under the hood: actions, not input

Today input handling and edits are tangled in `StackerSystem`. Before multiplayer, every edit becomes an **action** with a player id:

```ts
type Action =
  | { t: 'place'; player: string; blocks: PlacedSpec[] }
  | { t: 'move'; player: string; ids: string[]; to: PlacedSpec[] }
  | { t: 'delete'; player: string; ids: string[] }
  | { t: 'recolor'; player: string; ids: string[]; color: number; finish?: number }
  | { t: 'grab' | 'release'; player: string; ids: string[] }   // locks, for "first grab wins"
  | { t: 'kit'; player: string; op: 'start' | 'page' | 'exit'; kit?: string; step?: number };
```

- VR hands, the mouse and (later) remote players all produce actions; one function applies them to the build
- Placed blocks get stable ids, so actions can name them across machines
- Undo becomes per player: each player's stack holds the inverses of their own actions
- Solo play is unaffected; this is the seam multiplayer plugs into

## Multiplayer: what to research

Every one of these needs a spike before we commit to it.

| Question | Options to test |
|---|---|
| **Transport** on Spacefast | Zero's realtime layer is WebSocket-based, and its config advertises app sockets (`/api/socket/:name`) with no documented server API yet (see [10](10-accounts.md)). Live queries refresh in about 0.4 s: enough for blocks appearing, not for hands moving. Options: ask Spacefast about app sockets; WebRTC data channels between players with Zero passing the connection setup; a Functions worker relay (if it can hold sockets) |
| **State model** | Host-authoritative (the room's first player applies actions and rebroadcasts; simple, and locks are easy) vs a shared log of actions (CRDT-like, no host). Start with host-authoritative and host migration when the host leaves |
| **What travels** | Actions (small) for the build; poses at 15–30 Hz for heads, hands, desktop cameras and cursors (interpolated); a full snapshot (the save format, gzipped) when someone joins |
| **Voice** | WebRTC audio, positioned with Web Audio panners at each player's head or camera. Needs connection setup (the same as for data channels) and a TURN server for players behind strict NATs. Is there one on Spacefast, or do we need a provider? |
| **Rooms** | Open rooms keyed by a short code or link; a lobby list from Zero (a `rooms` table with a heartbeat). Guests are enough (sign-in is still blocked), with a chosen name and color |
| **Shared frame** | Everything is already stored in platform-local coordinates. Each player keeps their own platform pose and scale (a VR player's plate on their table, a desktop player's in their view), and remote heads, hands and cursors map through each one's own platform transform |
| **Kits together** | Kit state (which kit, the step each player is on, done pieces) becomes room state; ghost matching runs where the action is applied |
| **Persistence** | The room's build saves as a cloud save (once accounts land) or to the host's device |

## Plan

**Phase 1: desktop that feels native** (~1 week)
1. Camera: Figma-style trackpad gestures, mouse fallback, W A S D / Q / E, double-click focus (~1 day)
2. Brush: load, snap preview, click-to-stamp, R / T, Esc (~1–2 days)
3. HUD: parts browser with search, hotbar (recents + pins), swatches, status; hide the VR furniture on desktop (~2 days)
4. Power tools: eyedropper, marquee select, copy / paste / duplicate (~1 day)
5. Kit side panel + step hotbar (~half a day)

**Phase 2: actions and players** (~2–3 days): the action layer, stable block ids, per-player undo, a fake second "player" in tests driving actions.

**Phase 3: multiplayer spikes** (~2–3 days): transport on Spacefast (ask about app sockets; WebRTC with Zero passing the setup), two browsers sharing a plate, poses at 20 Hz, voice between two peers, TURN needs.

**Phase 4: rooms v1:** open rooms, presence, first-grab locks, shared kits, voice, join snapshots, host migration.
