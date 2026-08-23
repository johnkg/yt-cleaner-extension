// ─────────────────────────────────────────────────────────────
// CONFIG — replace with your own OAuth Client ID (see README.md)
//
// This file is the SINGLE source of truth for the Client ID. It is
// loaded both by the app page (via a <script> tag in app.html) and by
// the background script (via importScripts() in a service-worker
// context, or via the manifest "scripts" array in Firefox's classic
// background context). See background.js for details.
// ─────────────────────────────────────────────────────────────

/** @type {string} */
const CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";

/** @type {string} */
const SCOPES = "https://www.googleapis.com/auth/youtube";
