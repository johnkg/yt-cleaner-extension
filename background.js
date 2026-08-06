// CLIENT_ID/SCOPES are duplicated here (rather than imported from
// config.js) because this file needs to load correctly whether the
// browser treats it as a true service worker or a classic background
// script — and importScripts()/import only work in some of those
// contexts. If you update your Client ID, update it in BOTH this file
// and config.js.
const CLIENT_ID = "507886767514-rarf81ii7rksmfnkj0gm3oqr73hjnp2l.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/youtube";
// which kills any code running in the popup. So the actual OAuth flow
// lives here instead — the background script keeps running regardless
// of whether the popup is open.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGIN") {
    handleLogin()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }
});

async function handleLogin() {
  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "token",
    redirect_uri: redirectUri,
    scope: SCOPES,
    prompt: "consent",
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  const fragment = new URL(redirectUrl).hash.substring(1);
  const parsed = new URLSearchParams(fragment);
  const token = parsed.get("access_token");
  const expiresIn = parseInt(parsed.get("expires_in") || "3600", 10);

  if (!token) {
    throw new Error("No access token returned. Check your OAuth Client ID setup.");
  }

  const expiresAt = Date.now() + expiresIn * 1000;
  await chrome.storage.local.set({ accessToken: token, expiresAt });

  // Let the user know sign-in finished (popup may be closed by now, so
  // this also serves as a fallback notification).
  try {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  } catch (_) {
    /* badge API not critical, ignore failures */
  }

  return { success: true };
}
