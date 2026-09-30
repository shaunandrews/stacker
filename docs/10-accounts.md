# 10 · Accounts & social (plan and spike)

Status: **planning**. Nothing here ships yet. This is what we want, what we chose, and what a local spike on Spacefast Zero proved (Sept 2026).

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

A throwaway capsule ([`spikes/zero-accounts/`](../spikes/zero-accounts)) run with `sf dev` (Zero SDK 0.5.0), locally, no Space touched.

| Question | Answer | How we know |
|---|---|---|
| Can Stacker (plain TypeScript, no framework) use Zero? | **Yes, two ways.** (1) A *bridge*: a tiny Preact component with no UI that holds Zero's hooks and hands them to plain code (`window.zero.save(...)`, live results pushed through a callback). (2) HTTP endpoints called with `authenticatedFetch`. The SDK's only public data API is hooks; there's also `@spacefast/zero/react`, documented for "front ends outside the capsule" | Bridge ran in the browser: saves in ~200 ms, the live query updated ~400 ms after the call |
| Do guests work out of the box? | **Yes.** Every visitor gets a guest identity; handlers see `ctx.auth` (`guest:…`, `isGuest`) | `/api/me` returned the guest; its rows were scoped to it |
| Does a guest keep their stuff after signing in? | **Built in**: fields declared `userId()` move from the guest to the account in one transaction on first sign-in, with an `onGuestUpgrade` hook. Local dev can't sign in for real, so this is **not yet tested** | SDK types and README |
| How big can a build be? | **Keep each write under ~48 KB.** Mutations ride the realtime socket, which dropped the connection somewhere between 64 and 95 KB (flaky in that range). Endpoint bodies top out near 1 MiB locally (2 MiB documented hosted). A ~900 KB response crashed the local runtime (a QuickJS abort) | Timed saves at 10–300 KB |
| Is that enough? | **Yes, compressed.** Our save format gzips very well: a 363-piece build is 28 KB as JSON and 3 KB gzipped (a repetitive case; real builds compress less). `CompressionStream` is in the Quest browser. Builds past the limit get chunked across rows or go to Storage (5 MiB per file) | Measured on the Fire Station's pieces in our save format |
| Anything to avoid? | **`req.text()` / `req.json()` on big bodies**: they get slower with the square of the size (50 KB 1 s, 100 KB 4.2 s, then the 5 s limit). `req.bytes()` is instant; decode it ourselves (5 ms for 100 KB, 47 ms for 900 KB) | `/api/t-text`, `/api/t-bytes`, `/api/t-decode` in the spike |
| Phone pairing (QR)? | **No platform session handoff.** Plan: the headset (a guest) shows a code and QR; the phone opens `/pair/<code>`, signs in, and claims it; a `links` table maps the headset's guest id to the account, and every handler resolves the effective user through it. Fallback: Google sign-in directly in the Quest browser | SDK and docs have no device-code flow |
| Live co-building later (v2)? | **Partly.** Live queries refresh within about 0.4 s: enough for blocks appearing on a shared platform. Hands and heads need more: the runtime config advertises app sockets (`socketPath: /api/socket/:name`) but there's no documented server API yet. Fallback: peer-to-peer WebRTC with Zero passing the connection setup | `/__zero/config` from the dev server |

### Only the hosted platform can answer

These need a real Space (a throwaway one, not the Stacker Space):

1. **Static files next to the capsule.** Hosted Zero serves published static files first, which is how Stacker's own build would sit beside the capsule. `sf dev` serves only capsule routes, so this is untested
2. **A Vite-bundled SDK on the same origin.** Stacker's bundle importing `@spacefast/zero/client` rather than code compiled by Zero
3. **Google sign-in inside the Quest browser**, and the guest-to-account upgrade
4. **Hosted payload limits** (socket frame, body, response) and whether `req.text()` is slow there too

### Worth reporting to Spacefast

- `req.text()` / `req.json()` are quadratic in the local runtime
- Returning a ~900 KB response aborts the runtime (`Assertion failed: list_empty(&rt->gc_obj_list)`)
- A large mutation fails with "Zero realtime connection closed before the request completed" instead of a size error
- The scaffolded `AGENTS.md` says fields are only `string()`, `boolean()`, `id()` and there's no outbound `fetch`; the SDK README (same version) documents `number()`, `userId()` and `fetch`

## Architecture that falls out

- **One Space.** Its published directory holds Stacker's Vite build *and* the capsule source (`server/`, `pages/`, `client/`, `sf.jsonc`). The app session cookie only works same-origin, so they have to share it. Capsule pages stay off `/` (Stacker owns it): web pages live at `/u/<handle>`, `/b/<build>`, `/join/<code>`, `/pair/<code>`
- **In the headset:** a Preact bridge mounted off-screen exposes auth, live queries and mutations to `StackerSystem`. Local saves (`localStorage`) stay the source of truth offline; cloud sync is additive
- **On the web:** profile, gallery, build and invite pages are ordinary Zero pages (Preact and the Zero kit), with a 3D build viewer reusing the catalog's `Viewer`
- **Build payload:** the existing save JSON (stable part ids and color codes), gzipped and base64'd, written by a mutation; chunked past ~48 KB. A thumbnail rendered by `ArtRenderer` goes to Storage

### Data model (first cut)

| Table | Fields |
|---|---|
| `profiles` | `user: userId()`, `handle`, `displayName`, `avatar` |
| `builds` | `owner: userId()`, `title`, `data` (gzip+base64), `chunks: number`, `blocks: number`, `thumb` (storage id), `visibility` (`private` / `friends` / `link`), `remixOf: id("builds")?` |
| `buildChunks` | `build: id("builds")`, `n: number`, `data` (only for big builds) |
| `invites` | `from: userId()`, `code`, `usedBy?`, `expiresAt` |
| `friends` | `a: userId()`, `b: userId()` (a row each way) |
| `likes` | `build: id("builds")`, `user: userId()` |
| `links` | `code`, `device: userId()` (the headset guest), `account?`, `expiresAt` |

Every read is filtered by the caller (`ctx.auth.requireIdentity()`); visibility is checked in the handler (Zero has no row-level security).

## Plan

1. **Hosted spike** (~half a day): the four open questions above, on a throwaway Space
2. **Identity** (~2 days): guest session, Google sign-in, phone pairing, profile
3. **Cloud saves** (~2 days): slots and autosave sync when signed in
4. **Friends** (~2 days): invite links, friends list, feed
5. **Share and remix** (~3 days): web gallery and build pages, a Friends tab in the headset library, remix with a credit chain
