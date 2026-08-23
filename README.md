# YouTube Playlist Cleaner — Browser Extension

A Chrome extension (Manifest V3) that removes videos older than a chosen
age from your YouTube playlists, with a preview step before anything is
deleted.

## Setup (one-time, ~5 minutes)

### 1. Load the extension to get its ID
1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select this folder
4. Note the **extension ID** shown on the card (looks like `abcdefghijklmnopabcdefghijklmnop`)

### 2. Create an OAuth Client ID
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or reuse one) and enable **YouTube Data API v3**
   (APIs & Services → Library)
3. Go to **APIs & Services → OAuth consent screen**
   - User type: External
   - Fill in required fields (app name, support email)
   - Under **Scopes**, add `https://www.googleapis.com/auth/youtube`
   - Under **Test users**, add every Google account that will use the
     extension (yourself + anyone you share it with, up to 100).
     This avoids needing Google's full verification process while testing.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Chrome Extension** (if not offered, use **Web application** instead)
   - If "Web application": under **Authorized redirect URIs**, add:
     `https://<YOUR_EXTENSION_ID>.chromiumapp.org/`
     (use the ID you copied in step 1)
5. Copy the generated **Client ID**

### 3. Add the Client ID to the extension
1. Open `config.js` — this is now the **single** place the Client ID
   lives. `background.js` loads it from here automatically (via
   `importScripts` in Chrome, or the manifest `scripts` array in
   Firefox), so you no longer edit it in two files.
2. Replace this line:
   ```js
   const CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";
   ```
   with your real client ID.
3. Go back to `chrome://extensions` and click the **Reload** icon on the
   extension card.

### 4. Use it
1. Click the extension icon in your toolbar — this opens the tool in a
   full browser tab (not a small popup).
2. Click **Sign in with Google**. A separate Google sign-in window
   opens — complete the sign-in there.
3. You may see "Google hasn't verified this app" on the consent screen —
   click **Advanced → Go to [app] (unsafe)**; this is expected until the
   app is fully verified (see note below).
4. Back in the app tab, your playlists load automatically, each with a
   checkbox — use **Select all** / **Deselect all** to quickly toggle
   them, or check individual playlists.
5. Set the age threshold on the right — a number plus a **days / months
   / years** dropdown.
6. Click **Preview (dry run)** to see what would be removed. Each listed
   video shows a thumbnail and an **↗** link that opens it on YouTube in
   a new tab.
7. Review the list, then click **Delete matched videos** to confirm.

### What else you can do

- **Delete an entire playlist** — click the 🗑 next to any playlist in
  the left list. This removes the whole playlist in one API call
  (50 units total, versus 50 units *per video* if you deleted them one
  by one), so it's much cheaper for clearing a big playlist.
- **Browse a playlist by creator** — pick a playlist and click **Load
  creators** to group its videos by the channel that uploaded them.
  Select a whole creator with **All**, then move those videos into
  another playlist or delete them in bulk. Loading the list is free (it
  uses data already fetched); moving costs 100 units per video (50 to
  add + 50 to remove) and deleting costs 50.
- **Combine playlists** — check the playlists you want to merge, pick a
  target playlist from the dropdown, and click **Combine**. Every video
  is copied into the target (duplicates already there are skipped).
  Optionally tick "remove each video from its original playlist" to turn
  the copy into a true move. Note: adding a video costs 50 API units
  each, so combining large playlists uses a lot of your daily quota —
  the app shows the estimated cost and asks you to confirm first.
- **Find videos saved in multiple playlists** — check two or more
  playlists and click **Scan … for duplicates**. Any video that appears
  in more than one is listed; one copy is kept by default and you can
  remove the rest.
- **Playlist runtimes** — check some playlists and click **Durations**
  in the Playlists header to total up how long each one runs
  (e.g. `6h 12m`). Unlike thumbnails and creators this isn't free — it
  needs a second API call for the runtimes — but it's only about
  2 units per 50 videos. Totals are kept when you refresh, and
  recalculated if a playlist's video count changed.
- **Find videos by duration** — pick a playlist and a min and/or max
  length in minutes to list everything in that range, longest first.
  Handy for clearing out Shorts (max 2 minutes) or pulling long talks
  into their own playlist. Selected videos can be moved or deleted in
  bulk. Videos that report no runtime (live streams, unavailable
  videos) are skipped rather than guessed at, and the count of skipped
  ones is shown.

## API quota ("credits")

Your Google Cloud project gets **10,000 API units per day** by default,
resetting at **midnight US Pacific time**. The pill in the top-right
shows roughly how many you have left.

Because the YouTube Data API does not report your remaining quota, that
number is a **local estimate**: the extension knows what each operation
costs and tallies its own spending in browser storage. It's exact for
work done through this extension, but it can't see quota spent by other
apps or on other devices sharing the same Client ID. If the API reports
the quota is actually exhausted, the display corrects itself to zero.

What things cost:

| Operation | Units |
|---|---|
| Reading playlists / playlist contents | 1 per page of up to 50 items |
| Looking up video runtimes | 1 per 50 videos |
| Removing a video from a playlist | 50 |
| Adding a video to a playlist | 50 |
| Deleting an entire playlist | 50 (regardless of size) |

Video thumbnails, video links, the creator grouping, and duplicate
detection all cost **nothing extra** — they use data that already comes
back with the playlist reads. Durations are the one read-only feature
that costs something, because runtimes need a separate lookup; that's
why they're calculated on demand rather than shown automatically.

## Type-checking (for developers)

The extension is plain JavaScript with **no build step** — the browser
loads the `.js` files directly, so runtime speed is unchanged. The code
is fully type-annotated with JSDoc and checked by TypeScript. To run the
check (optional, dev-only — never needed to *run* the extension):

```
npm install
npm run typecheck
```

`node_modules`, `package.json`, and `tsconfig.json` are development-only
and are not loaded by the extension at runtime.

## Using this on Firefox

Firefox's OAuth redirect domain differs from Chrome's, and — without a
pinned ID — Firefox assigns a **new random extension ID every time you
reload a temporary add-on**, which breaks OAuth since the redirect URI
would change each time. This extension now pins a fixed ID via
`browser_specific_settings.gecko.id` in `manifest.json`, so the redirect
URI stays stable across reloads. Steps:

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
   → select `manifest.json` inside this folder.
2. Click the extension's toolbar icon to open the app in a full tab. On
   the sign-in screen, you'll see a **redirect URI** field with a
   **Copy** button — copy that exact value.
3. In Google Cloud Console, edit your OAuth client (must be a **Web
   application** type client — Firefox won't work with a Chrome-specific
   client type) and add the copied URI under **Authorized redirect URIs**
   (you can list both the Chrome and Firefox URIs on the same client).
4. Reload the add-on and try signing in again.

Note: `about:debugging` temporary add-ons are removed when Firefox
closes, so you'll need to re-load it each session unless you package
and self-host a signed `.xpi` (Firefox requires all installed
extensions to be signed by Mozilla, even for personal use outside of
Developer/Nightly builds).

## Troubleshooting

**Nothing happens after clicking "Sign in with Google" — no window opens:**
This usually means the background script isn't running, so the app
tab's message to it never arrives (you should now see a red error
explaining this, rather than the flow silently doing nothing). To check
directly:
- **Chrome:** go to `chrome://extensions`, find this extension, click
  **service worker** (or **Inspect views: service worker**) to open its
  console. Look for red errors.
- **Firefox:** go to `about:debugging#/runtime/this-firefox`, find this
  extension, click **Inspect**. Look for red errors in the console that
  opens.

Common causes: a JavaScript syntax error in `background.js` (nothing
will load at all), or the `CLIENT_ID` placeholder in `background.js` or
`config.js` not having been replaced with a real value.

**"redirect_uri_mismatch" or "Access blocked: Authorization Error":**
The redirect URI shown on the sign-in screen doesn't match what's
registered in Google Cloud Console. Copy it again (it can change if you
reload a temporary Firefox add-on without a pinned `gecko.id`, or if you
switch browsers) and re-add it under **Authorized redirect URIs**.

## Sharing this with other people

Since the extension isn't loaded from the Chrome Web Store, each person
who wants to use it needs to:
- Load it as an unpacked extension themselves (steps above), **or**
- You package/distribute it (e.g. as a `.zip` or via internal company
  distribution)

Either way, **every Google account that signs in must be added as a test
user** in your OAuth consent screen (Cloud Console → OAuth consent screen
→ Test users) until you complete Google's verification process. Test
mode caps you at 100 users total, which is generally plenty for
sharing with friends/colleagues, but not for public/store distribution.

Full verification (required to remove the "unverified app" warning and
to lift the 100-user cap) requires: a privacy policy URL, a scope
justification, and — because `.../auth/youtube` is a "sensitive" scope
— a CASA security assessment. This is worth doing only if you plan to
publish the extension publicly.

## Notes

- "Age" is based on the video's upload date by default. Check "Base age
  on when added to playlist" to use the add-date instead. The threshold
  can be expressed in days, months, or years.
- **Removing "watched" videos is not supported**, because the YouTube
  Data API v3 does not expose watch history or a watched/unwatched flag
  for videos in a playlist (that capability was removed from the API
  years ago). There is no reliable way for the extension to know which
  videos you've already watched, so this feature was intentionally left
  out rather than implemented unreliably.
- This tool can only manage playlists you own — "Liked Videos" and
  "Watch Later" aren't accessible via the API.
- Access tokens expire after about an hour; you'll just need to sign in
  again when that happens (no data is lost).
- All processing happens locally in your browser — no external server
  is involved beyond Google's own API.
