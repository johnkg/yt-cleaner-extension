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
1. Open `config.js` **and** `background.js` (the Client ID is needed in
   both — see the comment in `background.js` for why)
2. In each file, replace this line:
   ```js
   const CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";
   ```
   with your real client ID.
3. Go back to `chrome://extensions` and click the **Reload** icon on the
   extension card.

### 4. Use it
1. Click the extension icon in your toolbar → **Sign in with Google**
2. A separate Google sign-in window opens — **the extension popup will
   likely close automatically** the moment that window takes focus. This
   is normal browser behavior, not a bug. Complete the sign-in in that
   window.
3. Once you're done, click the extension icon again to reopen the
   popup — it will detect that you're now signed in and load your
   playlists automatically.
4. You may see "Google hasn't verified this app" on the consent screen —
   click **Advanced → Go to [app] (unsafe)**; this is expected until the
   app is fully verified (see note below).
5. Set the age threshold (in days), pick which playlists to include
6. Click **Preview (dry run)** to see what would be removed
7. Review the list, then click **Delete matched videos** to confirm

## Using this on Firefox

Firefox's OAuth redirect domain differs from Chrome's, and — without a
pinned ID — Firefox assigns a **new random extension ID every time you
reload a temporary add-on**, which breaks OAuth since the redirect URI
would change each time. This extension now pins a fixed ID via
`browser_specific_settings.gecko.id` in `manifest.json`, so the redirect
URI stays stable across reloads. Steps:

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
   → select `manifest.json` inside this folder.
2. Click the extension's toolbar icon to open the popup. On the sign-in
   screen, you'll see a **redirect URI** field with a **Copy** button —
   copy that exact value.
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
This usually means the background script isn't running, so the popup's
message to it never arrives (you should now see a red error explaining
this, rather than the flow silently doing nothing). To check directly:
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
  on when added to playlist" to use the add-date instead.
- This tool can only manage playlists you own — "Liked Videos" and
  "Watch Later" aren't accessible via the API.
- Access tokens expire after about an hour; you'll just need to sign in
  again when that happens (no data is lost).
- All processing happens locally in your browser — no external server
  is involved beyond Google's own API.
