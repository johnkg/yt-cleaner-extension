# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 browser extension (Chrome + Firefox) that cleans up a user's own YouTube playlists via the YouTube Data API v3: remove videos older than a threshold, delete entire playlists, combine playlists, and find videos duplicated across playlists.

## Commands

There is **no build step** — the browser loads the `.js` files directly. "Running" the extension means loading it unpacked and reloading after edits:

- **Chrome:** `chrome://extensions` → enable Developer mode → *Load unpacked* → this folder. Reload via the ↻ icon after each change.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → select `manifest.json`.

Type-checking (dev-only, never needed to run the extension):

```bash
npm install        # one-time; installs typescript + @types/chrome
npm run typecheck  # tsc --noEmit — verifies JSDoc types
```

There is no test suite and no linter configured. `npm run typecheck` is the only automated check — run it after editing any `.js` file.

## Architecture

### No-build, JSDoc-typed JavaScript
The code is plain JS but fully type-annotated with JSDoc and checked by TypeScript (`tsconfig.json` has `checkJs`/`allowJs`, `noEmit`, `strict: false`). When editing, keep the JSDoc annotations accurate and use `/** @type {...} */` casts for `document.getElementById` results that need a specific element subtype (see the `byId` / `inputsAll` helpers in `app.js`). `node_modules`, `package.json`, `package-lock.json`, and `tsconfig.json` are development-only and are not loaded at runtime.

### UI shell: left rail + swappable panes
`app.html` is a fixed left rail (`.rail`) beside a `.workspace`. The rail holds brand, section nav (`#railNav`) and the quota meter; the workspace holds a sticky `.topbar` and a two-column `.content` — the **Playlists panel on the left, visible for every section**, and one active `.pane` on the right.

Each feature is a `<div class="pane" data-pane="…">`; `showSection()` in `app.js` toggles `.hidden` on the panes and `.active` on the matching `.navItem`, and sets `#paneTitle` from `SECTION_TITLES`. Adding a feature = a nav button, a pane, and a `SECTION_TITLES` entry. The Playlists panel deliberately stays outside the panes because the checked playlists drive the old-video scan, the duplicate scan and combine.

### Styling
`app.css` is a dark theme driven by custom properties on `:root` (`--bg`, `--s1`/`--s2`/`--s3` surfaces, `--bd`, `--tx`/`--mu`/`--dim` text, `--red` accent, `--grn` for positive/runtime values). Change the palette there, not at call sites. Numeric values (counts, runtimes, quota) use `--mono` with `tabular-nums` so columns align.

Fonts (Space Grotesk, IBM Plex Mono) are **bundled in `fonts/`** and declared with `@font-face` — no network fetch, so the extension stays self-contained and there's no flash of fallback text. Space Grotesk is a variable font: one file covers weights 300–700. Icons are inline stroked SVG (never emoji — they render differently per OS and don't inherit hover colour); the playlist delete icon lives in `TRASH_ICON` in `app.js`.

Checkboxes stay native and are themed with `accent-color`, which is why `.playlistCheckbox` / `.resultVideoCheckbox` / etc. have no CSS rules of their own — those classes are JS selector hooks only.

### Two execution contexts
1. **App page** — `app.html` loads `config.js` then `app.js`. This is the entire UI (clicking the toolbar icon opens `app.html` in a full tab, not a popup). `app.js` holds all UI logic and every YouTube API call except login.
2. **Background service worker** — `background.js`. It opens/focuses the app tab on toolbar click and **owns the OAuth flow**.

**OAuth lives in the background script on purpose:** the app tab can lose focus or close the instant the Google sign-in window opens, which would kill any auth code running in the page. `app.js` sends a `{ type: "LOGIN" }` message to `background.js`, which runs `chrome.identity.launchWebAuthFlow`, stores the token, and the page picks it up via `restoreSession()` on return.

### config.js is the single source of truth for CLIENT_ID
`CLIENT_ID` and `SCOPES` are defined only in `config.js`. It is loaded two ways depending on the background execution model, and `background.js` consumes those globals without redeclaring them:
- Chrome (MV3 service worker): `background.js` calls `importScripts("config.js")` (guarded by `typeof importScripts === "function"`).
- Firefox (classic background scripts): `config.js` is listed **before** `background.js` in `manifest.json`'s `background.scripts`, so its globals already exist and `importScripts` is skipped.

When changing the Client ID, edit `config.js` only.

### Auth token model
Tokens come from the implicit (`response_type=token`) OAuth flow and are stored in `chrome.storage.local` (`accessToken`, `expiresAt`). They expire after ~1 hour and there is **no refresh token** — re-login is required after expiry. A `401` from the API triggers `logout()`.

## API quota is a first-class design constraint

The user refers to YouTube Data API quota units as "credits" (10,000/day default). Costs drive feature design, so weigh them before adding API calls:
- `*.list` (playlists, playlistItems) = **1 unit** per page of up to 50 items.
- `playlistItems.delete` and `playlistItems.insert` = **50 units each**.
- `playlists.delete` = **50 units** for an entire playlist (this is why "delete whole playlist" is far cheaper than deleting its videos one by one).

**`playlistItems.list` is always fetched with `part=snippet,contentDetails`, and several features exist purely because that response already contains data we'd otherwise pay for.** Before adding an API call, check whether the field is already in this payload:
- `contentDetails.videoId` → video links, duplicate detection
- `snippet.thumbnails` → thumbnails
- `snippet.videoOwnerChannelTitle` / `videoOwnerChannelId` → the creators grouping

All of the above cost **zero** extra quota. The one exception is **durations**, which are *not* in the playlistItems payload: they need `videos.list?part=contentDetails`, which takes up to 50 ids per call at 1 unit each (`fetchDurations()` handles the batching). That's why runtimes are calculated on demand rather than shown automatically.

Bulk write operations are the expensive ones: "Combine playlists" and the "Move" actions must show an estimated cost and confirm with the user before running.

### Shared bulk operations
The "by creator" and "by duration" sections are two different pickers over the same two actions, so the write logic lives in `moveVideosTo()` / `deleteVideosFromPlaylist()` (with `withFailureNote()` for the result message). Both take a `report` callback so each section can drive its own status line. A move always inserts into the target *before* deleting from the source, so a mid-operation failure can never lose a video — preserve that ordering.

### Quota display is a local estimate
The API does not report remaining quota, so `app.js` tallies it itself: `spendQuota()` is called from `ytFetch`/`ytDelete`/`ytPost`, persisted (debounced) to `chrome.storage.local` as `quotaUsed`/`quotaDay`. The quota day is computed in **US Pacific time** via `pacificNow()` (`Intl.DateTimeFormat` with `America/Los_Angeles`, which handles DST) — not local midnight. If the API returns a `quotaExceeded` error, `apiError()` pins the local estimate to the limit so the display matches reality. Any new API call must route through those three helpers to stay counted.

## Known constraints

- **Only user-owned playlists** are manageable; "Liked Videos" / "Watch Later" are not exposed by the API.
- **"Watched" status is not available** from the Data API v3 (no watch-history field), so a "remove watched videos" feature cannot be implemented reliably — do not attempt it via this API.
- Firefox needs a pinned extension ID (`browser_specific_settings.gecko.id` in `manifest.json`) to keep the OAuth redirect URI stable across reloads. The sign-in screen shows the current redirect URI with a Copy button for registering in Google Cloud Console.
