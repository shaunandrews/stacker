# 10 · Accounts & social (plan and spike)

Status: **planning**. Nothing here ships yet. This is what we want, what we chose, and what a spike on Spacefast Zero proved, locally and on a throwaway Space (Sept 2026). **Blocker:** app sign-in isn't enabled for our Spacefast team.

## What we want

From the requirements interview (2026-09-30):

| | |
|---|---|
| Social loop | Share and browse builds, remix builds (with credit), build together live |
| Audience | Friends, invite-only at first. An invite link makes you mutual friends; the feed shows friends' builds |
| Surface | Headset and web: save and share in XR, browse profiles and the gallery on the web |
| Sign-in | Guest first, account later; Google; pair with a phone by QR code (no typing in the headset) |
| Default visibility | Friends |
| Hard constraint | Stays on Spacefast (no Supabase, Firebase and the like) |
| v1 | Accounts, cloud saves, profiles, friends, sharing, remixing |
| v2 | Live co-building (v1 must not block it) |

## The choice: Spacefast Zero

Every Space can run **Zero**: TypeScript server code (queries, mutations, actions, HTTP endpoints) next to the Space's own MySQL database, with app users (guest, Google, Gravatar, Spacefast sign-in), live queries and file storage. We picked it over WordPress-as-backbone (no guest mode, awkward sign-in from a headset web app, no live updates) and a hybrid (two systems before we need two). WordPress stays available behind the Space for editorial content later.

## What the spike found

### Locally

A throwaway capsule ([`spikes/zero-accounts/`](../spikes/zero-accounts)) run with `sf dev` (Zero SDK 0.5.0).

| Question | Answer | How we know |
|---|---|---|
| Can Stacker (plain TypeScript, no framework) use Zero? | **Yes, two ways.** (1) A *bridge*: a tiny Preact component with no UI that holds Zero's hooks and hands them to plain code (`window.zero.save(...)`, live results pushed through a callback). (2) HTTP endpoints called with `authenticatedFetch`. The SDK's only public data API is hooks; there's also `@spacefast/zero/react`, documented for "front ends outside the capsule" | Bridge ran in the browser: saves in ~200 ms, the live query updated ~400 ms after the call |
| Do guests work out of the box? | **Yes.** Every visitor gets a guest identity; handlers see `ctx.auth` (`guest:…`, `isGuest`) | `/api/me` returned the guest; its rows were scoped to it |
| Does a guest keep their stuff after signing in? | **Built in**: fields declared `userId()` move from the guest to the account in one transaction on first sign-in, with an `onGuestUpgrade` hook. Local dev can't sign in for real, so this is **not yet tested** | SDK types and README |
| How big can a build be? | **Locally, keep each write small.** Mutations ride the realtime socket, which dropped the connection somewhere between 64 and 95 KB (flaky in that range; hosted, the real limit is the 64 KB field, below). Endpoint bodies top out near 1 MiB locally (2 MiB documented hosted). A ~900 KB response crashed the local runtime (a QuickJS abort) | Timed saves at 10–300 KB |
| Is that enough? | **Yes, compressed.** Our save format gzips very well: a 363-piece build is 28 KB as JSON and 3 KB gzipped (a repetitive case; real builds compress less). `CompressionStream` is in the Quest browser. Builds past the limit get chunked across rows or go to Storage (5 MiB per file) | Measured on the Fire Station's pieces in our save format |
| Anything to avoid? | **`req.text()` / `req.json()` on big bodies**: they get slower with the square of the size (50 KB 1 s, 100 KB 4.2 s, then the 5 s limit). `req.bytes()` is instant; decode it ourselves (5 ms for 100 KB, 47 ms for 900 KB) | `/api/t-text`, `/api/t-bytes`, `/api/t-decode` in the spike |
| Phone pairing (QR)? | **No platform session handoff.** Plan: the headset (a guest) shows a code and QR; the phone opens `/pair/<code>`, signs in, and claims it; a `links` table maps the headset's guest id to the account, and every handler resolves the effective user through it. Fallback: Google sign-in directly in the Quest browser | SDK and docs have no device-code flow |
| Live co-building later (v2)? | **Partly.** Live queries refresh within about 0.4 s: enough for blocks appearing on a shared platform. Hands and heads need more: the runtime config advertises app sockets (`socketPath: /api/socket/:name`) but there's no documented server API yet. Fallback: peer-to-peer WebRTC with Zero passing the connection setup | `/__zero/config` from the dev server |

### On a real Space

Tested on a throwaway Space (`stacker-zero-spike.view.fast`, team `shaun-team`) holding Stacker's production build, the spike capsule and a Vite-built test page (`spikes/zero-accounts/lab/`).

| Question | Answer |
|---|---|
| Can Stacker's build and the capsule share one Space? | **Yes.** One publish: `/` serves Stacker, `/catalog.html`, `parts.bin` and the kits serve as before, `/bridge` is a Zero page, `/api/*` are capsule endpoints. (Stacker's full boot there wasn't watched end to end; every file it loads serves with the right type) |
| Can Vite-bundled code use the SDK? | **Yes.** The test page bundles Preact and `@spacefast/zero/client` itself (238 KB, 71 KB gzipped): guest identity, live queries, mutations and `authenticatedFetch` all work same-origin |
| Guests? | **Yes**, even with Users off: every visitor gets `guest:anon_…` and their own rows |
| Google sign-in, guest upgrade? | **Blocked.** "Space users are not available for this team" on `shaun-team`. Needs the feature turned on (maybe the `automattic` team has it) |
| Pairing? | **Headset half works:** a guest makes a code and sees it live (`myPair`). The phone half needs sign-in |
| How big can one value be? | **~64 KB.** A 60 KB string saves; 70 KB fails (MySQL `TEXT`, 65,535 bytes). Mutations fail at 64 KB for the same reason. So build data is chunked into rows of ≤ 60,000 characters |
| Request bodies? | Endpoints take 500 KB; 1.5 MB is refused (413). `req.text()` is fine hosted (100 KB in 209 ms); the slowdown was local only |
| Storage? | **Signed-in only.** Guests get "Sign in before uploading objects". Guests' builds live in rows; thumbnails and big builds go to Storage once signed in |
| Speed | A mutation round trip is 0.4–0.6 s hosted |
| Errors | Anything thrown in a mutation arrives as "Zero mutation.run request failed": the app has to return error states rather than throw them |

Rough edges found along the way are collected locally for review (`spikes/zero-accounts/FEEDBACK.md`, git-ignored) and haven't been reported yet.

## Architecture that falls out

- **One Space.** Its published directory holds Stacker's Vite build *and* the capsule source (`server/`, `pages/`, `client/`, `sf.jsonc`). The app session cookie only works same-origin, so they have to share it. Capsule pages stay off `/` (Stacker owns it): web pages live at `/u/<handle>`, `/b/<build>`, `/join/<code>`, `/pair/<code>`
- **In the headset:** a Preact bridge mounted off-screen exposes auth, live queries and mutations to `StackerSystem`. Local saves (`localStorage`) stay the source of truth offline; cloud sync is additive
- **On the web:** profile, gallery, build and invite pages are ordinary Zero pages (Preact and the Zero kit), with a 3D build viewer reusing the catalog's `Viewer`
- **Build payload:** the existing save JSON (stable part ids and color codes), gzipped and base64'd, in rows of at most 60,000 characters (the `TEXT` limit), written by mutations. Thumbnails rendered by `ArtRenderer` go to Storage once signed in; guests get none (or a tiny inline one)

### Data model (first cut)

| Table | Fields |
|---|---|
| `profiles` | `user: userId()`, `handle`, `displayName`, `avatar` |
| `builds` | `owner: userId()`, `title`, `data` (gzip+base64, ≤ 60,000 chars), `chunks: number`, `blocks: number`, `thumb` (storage id), `visibility` (`private` / `friends` / `link`), `remixOf: id("builds")?` |
| `buildChunks` | `build: id("builds")`, `n: number`, `data` (≤ 60,000 chars; only for big builds) |
| `invites` | `from: userId()`, `code`, `usedBy?`, `expiresAt` |
| `friends` | `a: userId()`, `b: userId()` (a row each way) |
| `likes` | `build: id("builds")`, `user: userId()` |
| `links` | `code`, `device: userId()` (the headset guest), `account?`, `expiresAt` |

Every read is filtered by the caller (`ctx.auth.requireIdentity()`); visibility is checked in the handler (Zero has no row-level security).

## Plan

1. **Turn on app users** for the team (blocker), then finish the spike: Google sign-in in the Quest browser, guest upgrade, the phone half of pairing
2. **Identity** (~2 days): guest session, Google sign-in, phone pairing, profile
3. **Cloud saves** (~2 days): slots and autosave sync when signed in
4. **Friends** (~2 days): invite links, friends list, feed
5. **Share and remix** (~3 days): web gallery and build pages, a Friends tab in the headset library, remix with a credit chain
