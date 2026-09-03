// CLIENT_ID and SCOPES come from config.js (loaded before this file).
//
// This file is plain JavaScript, but fully type-checked via JSDoc — run
// `npm run typecheck` (see tsconfig.json). There is no build step: the
// browser loads this file as-is, so runtime speed is unchanged.

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
/**
 * @typedef {Object} Playlist
 * @property {string} id
 * @property {string} title
 * @property {number} count
 * @property {number | null} [durationSecs] total runtime, once calculated on demand
 */

/**
 * @typedef {Object} VideoMatch
 * @property {string} itemId   playlistItem id (needed to remove it)
 * @property {string} videoId  the underlying video id (for links / dedupe)
 * @property {string} title
 * @property {string | null} date  ISO date string used for the age filter
 * @property {string | null} thumb thumbnail URL (already included in the snippet part)
 */

/**
 * @typedef {Object} DupCopy
 * @property {string} playlistId
 * @property {string} playlistTitle
 * @property {string} itemId
 */

/**
 * @typedef {Object} CreatorVideo
 * @property {string} itemId
 * @property {string} videoId
 * @property {string} title
 * @property {string | null} thumb
 */

/**
 * @typedef {Object} CreatorGroup
 * @property {string} channelTitle
 * @property {CreatorVideo[]} videos
 */

/**
 * @typedef {Object} DurationVideo
 * @property {string} itemId
 * @property {string} videoId
 * @property {string} title
 * @property {string | null} thumb
 * @property {number} secs
 */

/**
 * A video selected for a bulk move/delete.
 * @typedef {Object} SelectedVideo
 * @property {string} itemId
 * @property {string} videoId
 */

/**
 * What happened to one item in a bulk operation.
 * @typedef {Object} ItemOutcome
 * @property {string} itemId
 * @property {boolean} ok
 * @property {string} [error]
 */

/**
 * @typedef {Object} BulkResult
 * @property {number} done
 * @property {string[]} failures
 * @property {ItemOutcome[]} results
 */

/** @typedef {"days" | "months" | "years"} AgeUnit */

// ─────────────────────────────────────────────────────────────
// Typed DOM helpers
// ─────────────────────────────────────────────────────────────
/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
  return /** @type {T} */ (document.getElementById(id));
}

/**
 * All input elements matching a selector, as a typed array.
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLInputElement[]}
 */
function inputsAll(sel, root = document) {
  return /** @type {HTMLInputElement[]} */ (Array.from(root.querySelectorAll(sel)));
}

/** @param {string} videoId */
function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ─────────────────────────────────────────────────────────────
// API quota tracking
//
// The YouTube Data API does not report your remaining quota, so this is
// a LOCAL ESTIMATE: we know each operation's documented cost and tally
// them ourselves. It is exact for work done through this extension, but
// blind to quota spent by other apps/devices sharing the same Client ID.
// YouTube's quota resets at midnight PACIFIC time, not local midnight.
// ─────────────────────────────────────────────────────────────
const QUOTA_LIMIT = 10000; // default daily units for a Cloud project
const QUOTA_COST_LIST = 1; // any *.list call, per page of <=50 items
const QUOTA_COST_WRITE = 50; // playlistItems insert/delete, playlists delete

let quotaUsed = 0;
/** @type {string} */
let quotaDay = "";
/** @type {ReturnType<typeof setTimeout> | undefined} */
let quotaSaveTimer;

/**
 * Wall-clock time in US Pacific, regardless of the user's own timezone.
 * @param {Date} [d]
 * @returns {{day: string, hour: number, minute: number, second: number}}
 */
function pacificNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  /** @type {Record<string, string>} */
  const p = {};
  parts.forEach((x) => (p[x.type] = x.value));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    // "24" shows up at midnight in some engines; normalise it to 0.
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Human countdown to the next Pacific midnight (±1h on DST switch days). */
function quotaResetIn() {
  const { hour, minute, second } = pacificNow();
  const secsLeft = 86400 - (hour * 3600 + minute * 60 + second);
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function loadQuota() {
  const stored = await chrome.storage.local.get(["quotaUsed", "quotaDay"]);
  const today = pacificNow().day;
  if (stored.quotaDay === today) {
    quotaUsed = stored.quotaUsed || 0;
  } else {
    quotaUsed = 0; // new quota day — start over
  }
  quotaDay = today;
  renderQuota();
}

/**
 * Record spent units. Storage writes are debounced so a long scan
 * doesn't hammer chrome.storage on every page.
 * @param {number} units
 */
function spendQuota(units) {
  const today = pacificNow().day;
  if (today !== quotaDay) {
    quotaDay = today;
    quotaUsed = 0;
  }
  quotaUsed += units;
  renderQuota();
  clearTimeout(quotaSaveTimer);
  quotaSaveTimer = setTimeout(() => {
    chrome.storage.local.set({ quotaUsed, quotaDay });
  }, 800);
}

function renderQuota() {
  const remaining = Math.max(0, QUOTA_LIMIT - quotaUsed);
  const pct = Math.max(0, Math.min(100, (remaining / QUOTA_LIMIT) * 100));
  quotaMsg.textContent = remaining.toLocaleString();
  quotaBar.style.width = `${pct}%`;
  quotaBar.classList.toggle("quotaLow", remaining < QUOTA_LIMIT * 0.15);
  quotaReset.textContent = `resets in ${quotaResetIn()}`;
  quotaMsg.title =
    `~${remaining.toLocaleString()} of ${QUOTA_LIMIT.toLocaleString()} API units left. ` +
    `Estimated from this extension's own activity (${quotaUsed.toLocaleString()} units used today). ` +
    `The YouTube API doesn't report remaining quota, so usage from other apps or devices sharing ` +
    `this Client ID isn't counted. Quota resets at midnight US Pacific time.`;
}

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────
const loginView = byId("loginView");
const mainView = byId("mainView");
const loginBtn = /** @type {HTMLButtonElement} */ (byId("loginBtn"));
const logoutBtn = byId("logoutBtn");
const loginError = byId("loginError");
const loginInfo = byId("loginInfo");
const playlistList = byId("playlistList");
const refreshBtn = byId("refreshBtn");
const selectAllBtn = byId("selectAllBtn");
const deselectAllBtn = byId("deselectAllBtn");
const selectionSummary = byId("selectionSummary");
const amountInput = /** @type {HTMLInputElement} */ (byId("amountInput"));
const unitSelect = /** @type {HTMLSelectElement} */ (byId("unitSelect"));
const byAddedCheckbox = /** @type {HTMLInputElement} */ (byId("byAddedCheckbox"));
const previewBtn = /** @type {HTMLButtonElement} */ (byId("previewBtn"));
const deleteBtn = /** @type {HTMLButtonElement} */ (byId("deleteBtn"));
const resultsSection = byId("resultsSection");
const resultsList = byId("resultsList");
const resultsSelectAllBtn = byId("resultsSelectAllBtn");
const resultsDeselectAllBtn = byId("resultsDeselectAllBtn");
const resultsSelectionSummary = byId("resultsSelectionSummary");
const statusMsg = byId("statusMsg");
const quotaMsg = byId("quotaMsg");
const quotaBar = byId("quotaBar");
const quotaReset = byId("quotaReset");
const railSub = byId("railSub");
const railNav = byId("railNav");
const paneTitle = byId("paneTitle");
const content = byId("content");
const playlistsPanel = byId("playlistsPanel");

const creatorPlaylistSelect = /** @type {HTMLSelectElement} */ (byId("creatorPlaylistSelect"));
const creatorMoveTarget = /** @type {HTMLSelectElement} */ (byId("creatorMoveTarget"));
const creatorLoadBtn = /** @type {HTMLButtonElement} */ (byId("creatorLoadBtn"));
const creatorMoveBtn = /** @type {HTMLButtonElement} */ (byId("creatorMoveBtn"));
const creatorDeleteBtn = /** @type {HTMLButtonElement} */ (byId("creatorDeleteBtn"));
const creatorStatus = byId("creatorStatus");
const creatorSelectionSummary = byId("creatorSelectionSummary");
const creatorList = byId("creatorList");

const durationsBtn = /** @type {HTMLButtonElement} */ (byId("durationsBtn"));
const durPlaylistSelect = /** @type {HTMLSelectElement} */ (byId("durPlaylistSelect"));
const durMinInput = /** @type {HTMLInputElement} */ (byId("durMinInput"));
const durMaxInput = /** @type {HTMLInputElement} */ (byId("durMaxInput"));
const durFindBtn = /** @type {HTMLButtonElement} */ (byId("durFindBtn"));
const durMoveTarget = /** @type {HTMLSelectElement} */ (byId("durMoveTarget"));
const durMoveBtn = /** @type {HTMLButtonElement} */ (byId("durMoveBtn"));
const durDeleteBtn = /** @type {HTMLButtonElement} */ (byId("durDeleteBtn"));
const durStatus = byId("durStatus");
const durSelectionSummary = byId("durSelectionSummary");
const durList = byId("durList");

const combineTargetSelect = /** @type {HTMLSelectElement} */ (byId("combineTargetSelect"));
const combineRemoveSourceCheckbox = /** @type {HTMLInputElement} */ (byId("combineRemoveSourceCheckbox"));
const combineBtn = /** @type {HTMLButtonElement} */ (byId("combineBtn"));
const combineStatus = byId("combineStatus");

const dupScanBtn = /** @type {HTMLButtonElement} */ (byId("dupScanBtn"));
const dupDeleteBtn = /** @type {HTMLButtonElement} */ (byId("dupDeleteBtn"));
const dupStatus = byId("dupStatus");
const dupSelectionSummary = byId("dupSelectionSummary");
const dupList = byId("dupList");

/** @type {string | null} */
let accessToken = null;
/** @type {Playlist[]} */
let playlists = [];
/** @type {Record<string, VideoMatch[]> | null} */
let lastMatches = null;

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────
function getRedirectUri() {
  return chrome.identity.getRedirectURL();
}

function login() {
  loginError.classList.add("hidden");
  loginInfo.classList.remove("hidden");
  loginBtn.disabled = true;

  // The actual OAuth flow runs in the background script (background.js),
  // not here — this tab may close/lose focus the moment the Google
  // sign-in window takes over, which would otherwise kill this code
  // mid-flow. If that happens, the background script finishes the job
  // and stores the token anyway; restoreSession() picks it up on return.
  chrome.runtime.sendMessage({ type: "LOGIN" }, (response) => {
    loginBtn.disabled = false;
    if (chrome.runtime.lastError) {
      loginInfo.classList.add("hidden");
      showLoginError(
        `Could not reach the extension's background script: ${chrome.runtime.lastError.message}. ` +
          `Try reloading the extension. If this persists, check the background script's console ` +
          `for errors (see README troubleshooting section).`
      );
      return;
    }
    if (response && response.success) {
      restoreSession();
    } else if (response && response.error) {
      loginInfo.classList.add("hidden");
      showLoginError(response.error);
    }
  });
}

/** @param {string} msg */
function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove("hidden");
}

async function logout() {
  await chrome.storage.local.remove(["accessToken", "expiresAt"]);
  accessToken = null;
  mainView.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  loginView.classList.remove("hidden");
}

async function restoreSession() {
  const { accessToken: stored, expiresAt } = await chrome.storage.local.get([
    "accessToken",
    "expiresAt",
  ]);
  if (stored && expiresAt && Date.now() < expiresAt) {
    accessToken = stored;
    enterMainView();
  }
}

function enterMainView() {
  loginView.classList.add("hidden");
  mainView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  loadPlaylists();
}

// ─────────────────────────────────────────────────────────────
// Section navigation
//
// Each feature lives in its own pane behind the left rail, rather
// than one long scroll. The Playlists panel stays visible for every
// section, because the checked playlists drive the old-video scan,
// the duplicate scan and the combine action.
// ─────────────────────────────────────────────────────────────
/** @type {Record<string, string>} */
const SECTION_TITLES = {
  old: "Old videos",
  duration: "By duration",
  creator: "By creator",
  duplicates: "Duplicates",
  combine: "Combine",
};

/**
 * Sections driven by the checked playlists on the left. The others pick
 * a single playlist from their own dropdown, so the panel is just noise
 * there and gets hidden — the pane then takes the full width.
 */
const SECTIONS_USING_PLAYLIST_PANEL = new Set(["old", "duplicates", "combine"]);

/** @param {string} name */
function showSection(name) {
  document.querySelectorAll(".navItem").forEach((btn) => {
    const el = /** @type {HTMLElement} */ (btn);
    el.classList.toggle("active", el.dataset.section === name);
  });
  document.querySelectorAll(".pane").forEach((pane) => {
    const el = /** @type {HTMLElement} */ (pane);
    el.classList.toggle("hidden", el.dataset.pane !== name);
  });
  const usesPanel = SECTIONS_USING_PLAYLIST_PANEL.has(name);
  playlistsPanel.classList.toggle("hidden", !usesPanel);
  content.classList.toggle("solo", !usesPanel);
  paneTitle.textContent = SECTION_TITLES[name] || name;
}

railNav.addEventListener("click", (e) => {
  const btn = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (e.target).closest(".navItem")
  );
  if (btn && btn.dataset.section) showSection(btn.dataset.section);
});

// ─────────────────────────────────────────────────────────────
// YouTube API helpers
// ─────────────────────────────────────────────────────────────
/**
 * @param {string} path
 * @param {Record<string, string>} [params]
 * @returns {Promise<any>}
 */
async function ytFetch(path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  spendQuota(QUOTA_COST_LIST);
  if (res.status === 401) {
    await logout();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    throw apiError(res.status, await res.text(), "YouTube API error");
  }
  return res.json();
}

/**
 * @param {string} path
 * @param {Record<string, string>} [params]
 */
async function ytDelete(path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  spendQuota(QUOTA_COST_WRITE);
  if (!res.ok && res.status !== 204) {
    throw apiError(res.status, await res.text(), "Delete failed");
  }
}

/**
 * @param {string} path
 * @param {Record<string, string>} params
 * @param {unknown} body
 * @returns {Promise<any>}
 */
async function ytPost(path, params, body) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  spendQuota(QUOTA_COST_WRITE);
  if (!res.ok) {
    throw apiError(res.status, await res.text(), "Insert failed");
  }
  return res.json();
}

/**
 * Turn an API error body into a useful Error. A blown daily quota is by
 * far the most likely failure once you start bulk-moving videos, so it
 * gets a plain-English message instead of a raw JSON dump.
 * @param {number} status
 * @param {string} body
 * @param {string} verb
 * @returns {Error}
 */
function apiError(status, body, verb) {
  if (body.includes("quotaExceeded")) {
    // We clearly under-counted somewhere (or another app shares this
    // Client ID) — pin the local estimate to empty so the header agrees
    // with reality.
    quotaUsed = QUOTA_LIMIT;
    renderQuota();
    return new Error(
      `Daily YouTube API quota exhausted. It resets at midnight US Pacific time (about ${quotaResetIn()} from now).`
    );
  }
  return new Error(`${verb} (${status}): ${body}`);
}

/**
 * @param {string} path
 * @param {Record<string, string>} params
 * @returns {Promise<any[]>}
 */
async function fetchAllPages(path, params) {
  /** @type {any[]} */
  let items = [];
  /** @type {string | undefined} */
  let pageToken = undefined;
  do {
    const page = await ytFetch(path, {
      ...params,
      ...(pageToken ? { pageToken } : {}),
    });
    items = items.concat(page.items || []);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

async function loadPlaylists() {
  playlistList.innerHTML = `<p class="muted">Loading playlists…</p>`;
  try {
    const items = await fetchAllPages("playlists", {
      part: "snippet,contentDetails",
      mine: "true",
      maxResults: "50",
    });
    // Keep any durations already calculated so a refresh doesn't throw
    // away work the user paid quota for. Counts that changed invalidate
    // the old total, so those are dropped.
    /** @type {Map<string, {count: number, secs: number | null | undefined}>} */
    const prev = new Map(playlists.map((p) => [p.id, { count: p.count, secs: p.durationSecs }]));
    playlists = items.map((p) => {
      const before = prev.get(p.id);
      const count = p.contentDetails.itemCount;
      return {
        id: p.id,
        title: p.snippet.title,
        count,
        durationSecs: before && before.count === count ? before.secs : null,
      };
    });
    renderPlaylists();
    populatePlaylistSelects();
  } catch (err) {
    playlistList.innerHTML = `<p class="error">${asMessage(err)}</p>`;
  }
}

// Stroked SVG rather than an emoji glyph — emoji render differently on
// every OS and don't inherit the hover colour.
const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`;

const WARN_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

/**
 * playlistItem ids whose last delete attempt failed. Kept so the marker
 * survives a re-render of a list (the old-videos results, for example).
 * @type {Set<string>}
 */
const failedItemIds = new Set();

function renderPlaylists() {
  const totalVideos = playlists.reduce((n, p) => n + p.count, 0);
  railSub.textContent = `${playlists.length} playlist${playlists.length === 1 ? "" : "s"} · ${totalVideos.toLocaleString()} videos`;

  if (playlists.length === 0) {
    playlistList.innerHTML = `<p class="muted">No playlists found.</p>`;
    selectionSummary.textContent = "";
    return;
  }
  playlistList.innerHTML = "";
  playlists.forEach((p) => {
    const row = document.createElement("div");
    row.className = "playlistItem";
    row.innerHTML = `
      <label class="playlistMain">
        <input type="checkbox" class="playlistCheckbox" value="${p.id}" checked />
        <span class="title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>
        ${
          p.durationSecs == null
            ? ""
            : `<span class="playlistDuration" title="Total runtime">${formatTotal(p.durationSecs)}</span>`
        }
        <span class="count">${p.count}</span>
      </label>
      <button type="button" class="playlistDeleteBtn dangerLinkBtn" data-id="${p.id}" title="Delete this entire playlist">${TRASH_ICON}</button>
    `;
    playlistList.appendChild(row);
  });
  inputsAll(".playlistCheckbox").forEach((cb) => {
    cb.addEventListener("change", updateSelectionSummary);
  });
  playlistList.querySelectorAll(".playlistDeleteBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.id;
      if (id) deleteEntirePlaylist(id);
    });
  });
  updateSelectionSummary();
}

/**
 * Refill every playlist dropdown, preserving the current choice where
 * the playlist still exists.
 */
function populatePlaylistSelects() {
  /** @type {[HTMLSelectElement, string][]} */
  const selects = [
    [combineTargetSelect, "— pick a target playlist —"],
    [creatorPlaylistSelect, "— pick a playlist —"],
    [creatorMoveTarget, "— move selected into —"],
    [durPlaylistSelect, "— pick a playlist —"],
    [durMoveTarget, "— move selected into —"],
  ];
  selects.forEach(([sel, placeholder]) => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    playlists.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.title} (${p.count})`;
      sel.appendChild(opt);
    });
    if (playlists.some((p) => p.id === prev)) sel.value = prev;
  });
}

/** @returns {string[]} */
function getSelectedPlaylistIds() {
  return inputsAll(".playlistCheckbox:checked").map((el) => el.value);
}

/** @param {boolean} checked */
function setAllPlaylistsChecked(checked) {
  inputsAll(".playlistCheckbox").forEach((cb) => {
    cb.checked = checked;
  });
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const total = inputsAll(".playlistCheckbox").length;
  const selected = getSelectedPlaylistIds().length;
  selectionSummary.textContent =
    total === 0 ? "" : `${selected} of ${total} playlist(s) selected`;
}

// ─────────────────────────────────────────────────────────────
// Delete an entire playlist (cheap: 50 units total, vs 50/video)
// ─────────────────────────────────────────────────────────────
/** @param {string} playlistId */
async function deleteEntirePlaylist(playlistId) {
  const pl = playlists.find((p) => p.id === playlistId);
  const name = pl ? pl.title : playlistId;
  const confirmed = confirm(
    `Delete the ENTIRE playlist "${name}"${pl ? ` (${pl.count} video(s))` : ""}?\n\n` +
      `The playlist and its contents will be permanently removed. This cannot be undone.`
  );
  if (!confirmed) return;

  setStatus(`Deleting playlist "${name}"…`);
  try {
    await ytDelete("playlists", { id: playlistId });
    setStatus(`Deleted playlist "${name}".`);
    await loadPlaylists();
  } catch (err) {
    setStatus(asMessage(err), true);
  }
}

// ─────────────────────────────────────────────────────────────
// Age filter
// ─────────────────────────────────────────────────────────────
/**
 * Calendar-accurate cutoff date for "older than <amount> <unit>".
 * @param {number} amount
 * @param {AgeUnit} unit
 * @returns {Date}
 */
function cutoffFrom(amount, unit) {
  const d = new Date();
  if (unit === "days") d.setDate(d.getDate() - amount);
  else if (unit === "months") d.setMonth(d.getMonth() - amount);
  else d.setFullYear(d.getFullYear() - amount);
  return d;
}

/**
 * @param {string} playlistId
 * @param {Date} cutoffDate
 * @param {boolean} byAdded
 * @returns {Promise<VideoMatch[]>}
 */
async function getOldItemsForPlaylist(playlistId, cutoffDate, byAdded) {
  const items = await fetchAllPages("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: "50",
  });

  return items
    .map((item) => {
      const dateStr = byAdded
        ? item.snippet.publishedAt
        : item.contentDetails.videoPublishedAt || item.snippet.publishedAt;
      return {
        itemId: item.id,
        videoId: item.contentDetails.videoId,
        title: item.snippet.title,
        date: dateStr || null,
        thumb: thumbOf(item),
      };
    })
    .filter((v) => v.date && new Date(v.date) < cutoffDate);
}

// ─────────────────────────────────────────────────────────────
// Preview / Delete (old videos)
// ─────────────────────────────────────────────────────────────
/** @returns {Promise<Record<string, VideoMatch[]> | null>} */
async function runScan() {
  const amount = parseInt(amountInput.value, 10);
  if (!amount || amount < 1) {
    setStatus("Enter a valid number.", true);
    return null;
  }
  const unit = /** @type {AgeUnit} */ (unitSelect.value);
  const selectedIds = getSelectedPlaylistIds();
  if (selectedIds.length === 0) {
    setStatus("Select at least one playlist.", true);
    return null;
  }

  const cutoffDate = cutoffFrom(amount, unit);
  const byAdded = byAddedCheckbox.checked;
  /** @type {Record<string, VideoMatch[]>} */
  const matches = {};

  setStatus("Scanning playlists…");
  for (const pid of selectedIds) {
    try {
      matches[pid] = await getOldItemsForPlaylist(pid, cutoffDate, byAdded);
    } catch (err) {
      setStatus(asMessage(err), true);
      return null;
    }
  }
  return matches;
}

/** @param {Record<string, VideoMatch[]>} matches */
function renderResults(matches) {
  resultsSection.classList.remove("hidden");
  resultsList.innerHTML = "";
  let total = 0;

  Object.entries(matches).forEach(([pid, videos]) => {
    if (videos.length === 0) return;
    total += videos.length;
    const playlist = playlists.find((p) => p.id === pid);
    const playlistTitle = playlist ? playlist.title : pid;

    const group = document.createElement("details");
    group.className = "playlistGroup";
    group.open = true;
    group.dataset.playlistId = pid;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span>${escapeHtml(playlistTitle)}</span>
      <span class="groupHeaderRight">
        <span class="groupCount">${videos.length}</span>
        <button type="button" class="groupLinkBtn" data-action="select">All</button>
        <span class="dividerDot">·</span>
        <button type="button" class="groupLinkBtn" data-action="deselect">None</button>
      </span>
    `;
    group.appendChild(summary);

    const body = document.createElement("div");
    body.className = "groupBody";
    videos.forEach((v) => {
      const row = document.createElement("label");
      row.className = "videoRow";
      const dateShort = v.date ? new Date(v.date).toLocaleDateString() : "";
      row.innerHTML = `
        <input type="checkbox" class="resultVideoCheckbox" data-playlist-id="${pid}" data-item-id="${v.itemId}" checked />
        ${thumbHtml(v.thumb)}
        <span class="title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span>
        ${videoLinkHtml(v.videoId)}
        <span class="date">${dateShort}</span>
      `;
      if (failedItemIds.has(v.itemId)) markRowFailed(row);
      body.appendChild(row);
    });
    group.appendChild(body);
    resultsList.appendChild(group);

    const selectBtn = /** @type {HTMLElement} */ (summary.querySelector('[data-action="select"]'));
    const deselectBtn = /** @type {HTMLElement} */ (summary.querySelector('[data-action="deselect"]'));
    selectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      inputsAll(".resultVideoCheckbox", body).forEach((cb) => (cb.checked = true));
      updateResultsSelectionSummary();
    });
    deselectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      inputsAll(".resultVideoCheckbox", body).forEach((cb) => (cb.checked = false));
      updateResultsSelectionSummary();
    });
  });

  if (total === 0) {
    resultsList.innerHTML = `<p class="muted">No videos matched the threshold.</p>`;
    resultsSelectionSummary.textContent = "";
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Delete matched videos";
    // Clear the transient "Scanning playlists…" status on a successful,
    // empty result so it doesn't linger.
    setStatus("Scan complete — no videos matched the threshold.");
    return;
  }

  inputsAll(".resultVideoCheckbox").forEach((cb) => {
    cb.addEventListener("change", updateResultsSelectionSummary);
  });
  wireVideoLinks(resultsList);

  // Replaces the transient "Scanning playlists…" status.
  setStatus(
    `Found ${total} video(s) older than the threshold. Uncheck any you'd like to keep, then click Delete.`
  );
  updateResultsSelectionSummary();
}

/** @returns {{playlistId: string, itemId: string}[]} */
function getCheckedResultVideos() {
  return inputsAll(".resultVideoCheckbox:checked").map((cb) => ({
    playlistId: cb.dataset.playlistId || "",
    itemId: cb.dataset.itemId || "",
  }));
}

function updateResultsSelectionSummary() {
  const totalCheckboxes = inputsAll(".resultVideoCheckbox").length;
  const checked = getCheckedResultVideos().length;
  resultsSelectionSummary.textContent =
    totalCheckboxes === 0 ? "" : `${checked} of ${totalCheckboxes} video(s) selected for removal`;
  deleteBtn.disabled = checked === 0;
  deleteBtn.textContent =
    checked === 0 ? "Delete matched videos" : `Delete ${checked} selected video(s)`;
}

async function handlePreview() {
  previewBtn.disabled = true;
  deleteBtn.disabled = true;
  const matches = await runScan();
  previewBtn.disabled = false;
  if (matches) {
    lastMatches = matches;
    renderResults(matches);
  }
}

async function handleDelete() {
  const selected = getCheckedResultVideos();
  if (selected.length === 0) return;

  const confirmed = confirm(
    `This will permanently remove ${selected.length} video(s) from your playlist(s). ` +
      `Videos you unchecked will be kept. Continue?`
  );
  if (!confirmed) return;

  deleteBtn.disabled = true;
  setStatus("Deleting…");

  let removedCount = 0;
  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, number>} */
  const perPlaylist = new Map();

  for (const { playlistId, itemId } of selected) {
    try {
      await ytDelete("playlistItems", { id: itemId });
      removedCount++;
      failedItemIds.delete(itemId);
      perPlaylist.set(playlistId, (perPlaylist.get(playlistId) || 0) + 1);
      if (lastMatches && lastMatches[playlistId]) {
        lastMatches[playlistId] = lastMatches[playlistId].filter((v) => v.itemId !== itemId);
      }
    } catch (err) {
      // Keep it listed and flag it, so a failed delete is visible rather
      // than silently leaving the video in the playlist.
      failedItemIds.add(itemId);
      failures.push(asMessage(err));
    }
  }

  if (lastMatches) {
    renderResults(lastMatches);
  }
  perPlaylist.forEach((n, pid) => adjustPlaylistCount(pid, -n));

  const remaining = lastMatches
    ? Object.values(lastMatches).reduce((n, v) => n + v.length, 0)
    : 0;
  let msg = `Removed ${removedCount} video(s).`;
  if (remaining > 0) msg += ` ${remaining} kept (unchecked).`;
  if (failures.length > 0) msg += ` ${failures.length} failed — see console.`;
  if (failures.length > 0) console.error("Deletion failures:", failures);
  setStatus(msg, failures.length > 0);
}

// ─────────────────────────────────────────────────────────────
// Combine playlists
// ─────────────────────────────────────────────────────────────
async function handleCombine() {
  const targetId = combineTargetSelect.value;
  if (!targetId) {
    setCombineStatus("Pick a target playlist first.", true);
    return;
  }
  const sourceIds = getSelectedPlaylistIds().filter((id) => id !== targetId);
  if (sourceIds.length === 0) {
    setCombineStatus("Check at least one playlist (other than the target) on the left.", true);
    return;
  }
  const removeSource = combineRemoveSourceCheckbox.checked;
  const targetName = playlists.find((p) => p.id === targetId)?.title || targetId;

  combineBtn.disabled = true;
  setCombineStatus("Reading source playlists…");

  try {
    // Videos already in the target — so we don't add duplicates.
    const targetItems = await fetchAllPages("playlistItems", {
      part: "contentDetails",
      playlistId: targetId,
      maxResults: "50",
    });
    /** @type {Set<string>} */
    const alreadyInTarget = new Set(targetItems.map((i) => i.contentDetails.videoId));

    // Gather source videos (unique videoId), remembering one source
    // itemId per video so we can optionally remove it afterward.
    /** @type {{videoId: string, title: string, sourceItemId: string}[]} */
    const toMove = [];
    /** @type {Set<string>} */
    const seen = new Set();
    for (const sid of sourceIds) {
      const items = await fetchAllPages("playlistItems", {
        part: "snippet,contentDetails",
        playlistId: sid,
        maxResults: "50",
      });
      for (const it of items) {
        const vid = it.contentDetails.videoId;
        if (!vid || seen.has(vid) || alreadyInTarget.has(vid)) continue;
        seen.add(vid);
        toMove.push({ videoId: vid, title: it.snippet.title, sourceItemId: it.id });
      }
    }

    if (toMove.length === 0) {
      setCombineStatus(`Nothing to move — every video is already in "${targetName}".`);
      combineBtn.disabled = false;
      return;
    }

    const cost = toMove.length * 50 + (removeSource ? toMove.length * 50 : 0);
    const confirmed = confirm(
      `Move ${toMove.length} unique video(s) into "${targetName}"` +
        (removeSource ? ` and remove them from their source playlists` : ``) +
        `.\n\nEstimated cost: ~${cost} API units (of your 10,000/day default quota). Continue?`
    );
    if (!confirmed) {
      setCombineStatus("Cancelled.");
      combineBtn.disabled = false;
      return;
    }

    let moved = 0;
    let removed = 0;
    /** @type {string[]} */
    const failures = [];
    for (const v of toMove) {
      setCombineStatus(`Moving ${moved + 1} of ${toMove.length}: ${v.title}…`);
      try {
        await ytPost(
          "playlistItems",
          { part: "snippet" },
          {
            snippet: {
              playlistId: targetId,
              resourceId: { kind: "youtube#video", videoId: v.videoId },
            },
          }
        );
        moved++;
        if (removeSource) {
          try {
            await ytDelete("playlistItems", { id: v.sourceItemId });
            removed++;
          } catch (err) {
            failures.push(`remove ${v.title}: ${asMessage(err)}`);
          }
        }
      } catch (err) {
        failures.push(`add ${v.title}: ${asMessage(err)}`);
      }
    }

    let msg = `Moved ${moved} video(s) into "${targetName}".`;
    if (removeSource) msg += ` Removed ${removed} from source playlist(s).`;
    if (failures.length > 0) msg += ` ${failures.length} operation(s) failed — see console.`;
    if (failures.length > 0) console.error("Combine failures:", failures);
    setCombineStatus(msg, failures.length > 0);
    await loadPlaylists();
  } catch (err) {
    setCombineStatus(asMessage(err), true);
  } finally {
    combineBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
// Find videos saved in multiple playlists
// ─────────────────────────────────────────────────────────────
async function handleDupScan() {
  const selectedIds = getSelectedPlaylistIds();
  if (selectedIds.length < 2) {
    setDupStatus("Check at least two playlists on the left to compare.", true);
    return;
  }

  dupScanBtn.disabled = true;
  dupDeleteBtn.disabled = true;
  dupList.innerHTML = "";
  dupSelectionSummary.textContent = "";
  setDupStatus("Scanning playlists for duplicates…");

  try {
    // videoId -> { title, thumb, copies: DupCopy[] }
    /** @type {Map<string, {title: string, thumb: string | null, copies: DupCopy[]}>} */
    const byVideo = new Map();
    for (const pid of selectedIds) {
      const title = playlists.find((p) => p.id === pid)?.title || pid;
      const items = await fetchAllPages("playlistItems", {
        part: "snippet,contentDetails",
        playlistId: pid,
        maxResults: "50",
      });
      for (const it of items) {
        const vid = it.contentDetails.videoId;
        if (!vid) continue;
        const entry = byVideo.get(vid) || {
          title: it.snippet.title,
          thumb: thumbOf(it),
          copies: [],
        };
        entry.copies.push({ playlistId: pid, playlistTitle: title, itemId: it.id });
        byVideo.set(vid, entry);
      }
    }

    const dups = Array.from(byVideo.entries()).filter(([, e]) => e.copies.length > 1);
    renderDuplicates(dups);
  } catch (err) {
    setDupStatus(asMessage(err), true);
  } finally {
    dupScanBtn.disabled = false;
  }
}

/** @param {[string, {title: string, thumb: string | null, copies: DupCopy[]}][]} dups */
function renderDuplicates(dups) {
  dupList.innerHTML = "";
  if (dups.length === 0) {
    setDupStatus("No videos are saved in more than one of the checked playlists.");
    dupDeleteBtn.disabled = true;
    return;
  }

  dups.forEach(([videoId, entry]) => {
    const group = document.createElement("details");
    group.className = "playlistGroup";
    group.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span class="summaryLeft">${thumbHtml(entry.thumb)}<span>${escapeHtml(entry.title)}</span></span>
      <span class="groupHeaderRight">
        ${videoLinkHtml(videoId)}
        <span class="groupCount">${entry.copies.length} copies</span>
      </span>
    `;
    group.appendChild(summary);

    const body = document.createElement("div");
    body.className = "groupBody";
    // Keep the first copy unchecked (kept), pre-check the rest for removal.
    entry.copies.forEach((c, idx) => {
      const row = document.createElement("label");
      row.className = "videoRow";
      row.innerHTML = `
        <input type="checkbox" class="dupCheckbox" data-item-id="${c.itemId}" data-playlist-id="${c.playlistId}" ${idx === 0 ? "" : "checked"} />
        <span class="title" title="${escapeHtml(c.playlistTitle)}">in: ${escapeHtml(c.playlistTitle)}</span>
        <span class="date">${idx === 0 ? "keep" : "remove"}</span>
      `;
      body.appendChild(row);
    });
    group.appendChild(body);
    dupList.appendChild(group);
  });

  inputsAll(".dupCheckbox").forEach((cb) => {
    cb.addEventListener("change", updateDupSelectionSummary);
  });
  wireVideoLinks(dupList);
  setDupStatus(`Found ${dups.length} video(s) saved in multiple playlists.`);
  updateDupSelectionSummary();
}

function updateDupSelectionSummary() {
  const total = inputsAll(".dupCheckbox").length;
  const checked = inputsAll(".dupCheckbox:checked").length;
  dupSelectionSummary.textContent =
    total === 0 ? "" : `${checked} copy/copies selected for removal`;
  dupDeleteBtn.disabled = checked === 0;
  dupDeleteBtn.textContent =
    checked === 0 ? "Remove selected copies" : `Remove ${checked} selected copy/copies`;
}

async function handleDupDelete() {
  const picked = inputsAll(".dupCheckbox:checked").map((cb) => ({
    itemId: cb.dataset.itemId || "",
    playlistId: cb.dataset.playlistId || "",
  }));
  if (picked.length === 0) return;

  const confirmed = confirm(
    `Remove ${picked.length} duplicate copy/copies from their playlists? ` +
      `One copy of each video is kept. This cannot be undone.`
  );
  if (!confirmed) return;

  dupDeleteBtn.disabled = true;
  const { done, failures, results } = await deleteVideosFromPlaylist(
    picked.map((p) => ({ itemId: p.itemId, videoId: "" })),
    setDupStatus
  );

  // Count removals per playlist so the sidebar stays right without a refetch.
  /** @type {Map<string, number>} */
  const perPlaylist = new Map();
  const okIds = new Set(results.filter((r) => r.ok).map((r) => r.itemId));
  for (const p of picked) {
    if (okIds.has(p.itemId)) perPlaylist.set(p.playlistId, (perPlaylist.get(p.playlistId) || 0) + 1);
  }

  applyResultsToRows("dupCheckbox", results);
  perPlaylist.forEach((n, pid) => adjustPlaylistCount(pid, -n));

  // A video with only one copy left is no longer a duplicate.
  dupList.querySelectorAll(".playlistGroup").forEach((g) => {
    if (g.querySelectorAll(".videoRow").length < 2) g.remove();
  });

  updateDupSelectionSummary();
  setDupStatus(
    withFailureNote(`Removed ${done} duplicate copy/copies.`, failures, "Duplicate removal failures"),
    failures.length > 0
  );
}

// ─────────────────────────────────────────────────────────────
// Playlist total runtimes
// ─────────────────────────────────────────────────────────────
async function handleCalcDurations() {
  const selectedIds = getSelectedPlaylistIds();
  if (selectedIds.length === 0) {
    setStatus("Check the playlists whose runtime you want to total up.", true);
    return;
  }

  const targets = playlists.filter((p) => selectedIds.includes(p.id));
  const estimate = targets.reduce((n, p) => n + durationScanCost(p.count), 0);
  // Reads are cheap, so only interrupt when the total is worth noticing.
  if (estimate > 100) {
    const ok = confirm(
      `Total up the runtime of ${targets.length} playlist(s) (${targets.reduce((n, p) => n + p.count, 0)} videos)?\n\n` +
        `Estimated cost: ~${estimate} API units. Continue?`
    );
    if (!ok) return;
  }

  durationsBtn.disabled = true;
  /** @type {string[]} */
  const failures = [];
  let processed = 0;

  for (const p of targets) {
    processed++;
    setStatus(`Calculating runtime ${processed} of ${targets.length}: ${p.title}…`);
    try {
      const items = await fetchAllPages("playlistItems", {
        part: "contentDetails",
        playlistId: p.id,
        maxResults: "50",
      });
      const durations = await fetchDurations(items.map((i) => i.contentDetails?.videoId));
      let total = 0;
      durations.forEach((secs) => (total += secs));
      p.durationSecs = total;
      renderPlaylists();
    } catch (err) {
      failures.push(`${p.title}: ${asMessage(err)}`);
    }
  }

  const grand = targets.reduce((n, p) => n + (p.durationSecs || 0), 0);
  setStatus(
    withFailureNote(
      `Total runtime across ${targets.length} playlist(s): ${formatTotal(grand)}.`,
      failures,
      "Duration calculation failures"
    ),
    failures.length > 0
  );
  durationsBtn.disabled = false;
}

// ─────────────────────────────────────────────────────────────
// Shared bulk operations
//
// Used by both the "by creator" and "by duration" sections, which
// present different pickers over the same two actions.
// ─────────────────────────────────────────────────────────────
/**
 * Copy each video into the target playlist, then remove it from its
 * source — the delete only runs once the insert succeeded, so a failure
 * can never lose a video.
 * @param {SelectedVideo[]} selected
 * @param {string} targetId
 * @param {(msg: string, isError?: boolean) => void} report
 * @returns {Promise<BulkResult>}
 */
async function moveVideosTo(selected, targetId, report) {
  let done = 0;
  /** @type {string[]} */
  const failures = [];
  /** @type {ItemOutcome[]} */
  const results = [];
  for (const v of selected) {
    report(`Moving ${done + 1} of ${selected.length}…`);
    try {
      await ytPost(
        "playlistItems",
        { part: "snippet" },
        {
          snippet: {
            playlistId: targetId,
            resourceId: { kind: "youtube#video", videoId: v.videoId },
          },
        }
      );
      await ytDelete("playlistItems", { id: v.itemId });
      done++;
      results.push({ itemId: v.itemId, ok: true });
    } catch (err) {
      const msg = asMessage(err);
      failures.push(msg);
      results.push({ itemId: v.itemId, ok: false, error: msg });
    }
  }
  return { done, failures, results };
}

/**
 * @param {SelectedVideo[]} selected
 * @param {(msg: string, isError?: boolean) => void} report
 * @returns {Promise<BulkResult>}
 */
async function deleteVideosFromPlaylist(selected, report) {
  let done = 0;
  /** @type {string[]} */
  const failures = [];
  /** @type {ItemOutcome[]} */
  const results = [];
  for (const v of selected) {
    report(`Removing ${done + 1} of ${selected.length}…`);
    try {
      await ytDelete("playlistItems", { id: v.itemId });
      done++;
      results.push({ itemId: v.itemId, ok: true });
    } catch (err) {
      const msg = asMessage(err);
      failures.push(msg);
      results.push({ itemId: v.itemId, ok: false, error: msg });
    }
  }
  return { done, failures, results };
}

/**
 * Reflect a finished bulk operation in the list WITHOUT re-scanning:
 * rows that succeeded are dropped, rows that failed are flagged so you
 * can see exactly which ones to retry. A re-scan would re-read the whole
 * playlist (and its runtimes) and burn quota for no new information.
 * @param {string} checkboxClass
 * @param {ItemOutcome[]} results
 */
function applyResultsToRows(checkboxClass, results) {
  const byId = new Map(results.map((r) => [r.itemId, r]));
  inputsAll("." + checkboxClass).forEach((cb) => {
    const r = byId.get(cb.dataset.itemId || "");
    if (!r) return;
    const row = /** @type {HTMLElement | null} */ (cb.closest(".videoRow"));
    if (!row) return;
    if (r.ok) {
      failedItemIds.delete(r.itemId);
      row.remove();
      return;
    }
    // Leave it in place, unchecked and marked, so a retry is deliberate.
    failedItemIds.add(r.itemId);
    cb.checked = false;
    markRowFailed(row, r.error);
  });
}

/**
 * @param {HTMLElement} row
 * @param {string} [error]
 */
function markRowFailed(row, error) {
  row.classList.add("failed");
  const label = `Delete failed — still in the playlist. ${error || "Unknown error."}`;
  row.title = label;
  if (!row.querySelector(".failMark")) {
    const mark = document.createElement("span");
    mark.className = "failMark";
    mark.title = label;
    mark.innerHTML = WARN_ICON;
    row.appendChild(mark);
  }
}

/**
 * Keep the sidebar counts honest after a write, without spending a
 * request on it. The runtime total is dropped because it is now stale.
 * @param {string} playlistId
 * @param {number} delta
 */
function adjustPlaylistCount(playlistId, delta) {
  const p = playlists.find((x) => x.id === playlistId);
  if (!p || !delta) return;
  p.count = Math.max(0, p.count + delta);
  p.durationSecs = null;
  // Update just this row so the user's playlist selection isn't reset.
  const cb = inputsAll(".playlistCheckbox").find((c) => c.value === playlistId);
  const row = cb && /** @type {HTMLElement | null} */ (cb.closest(".playlistItem"));
  if (row) {
    const cnt = row.querySelector(".count");
    if (cnt) cnt.textContent = String(p.count);
    const dur = row.querySelector(".playlistDuration");
    if (dur) dur.remove();
  }
  const totalVideos = playlists.reduce((n, x) => n + x.count, 0);
  railSub.textContent = `${playlists.length} playlist${playlists.length === 1 ? "" : "s"} · ${totalVideos.toLocaleString()} videos`;
  populatePlaylistSelects();
}

/**
 * @param {string} base
 * @param {string[]} failures
 * @param {string} logLabel
 * @returns {string}
 */
function withFailureNote(base, failures, logLabel) {
  if (failures.length === 0) return base;
  console.error(`${logLabel}:`, failures);
  return `${base} ${failures.length} failed — see console.`;
}

// ─────────────────────────────────────────────────────────────
// Browse a playlist by creator
//
// playlistItems.list already returns videoOwnerChannelTitle/Id in the
// snippet part, so grouping by creator costs no extra API quota.
// ─────────────────────────────────────────────────────────────
/** Playlist the creator list currently describes (for move/delete). */
let creatorSourcePlaylistId = "";

async function handleLoadCreators() {
  const pid = creatorPlaylistSelect.value;
  if (!pid) {
    setCreatorStatus("Pick a playlist first.", true);
    return;
  }

  creatorLoadBtn.disabled = true;
  creatorList.innerHTML = "";
  creatorSelectionSummary.textContent = "";
  setCreatorStatus("Loading videos…");

  try {
    const items = await fetchAllPages("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: pid,
      maxResults: "50",
    });

    /** @type {Map<string, CreatorGroup>} */
    const groups = new Map();
    for (const it of items) {
      // Deleted/private videos carry no owner info — bucket them together.
      const key = it.snippet.videoOwnerChannelId || "__unknown__";
      const channelTitle =
        it.snippet.videoOwnerChannelTitle || "Unknown creator (deleted or private video)";
      const g = groups.get(key) || { channelTitle, videos: [] };
      g.videos.push({
        itemId: it.id,
        videoId: it.contentDetails.videoId,
        title: it.snippet.title,
        thumb: thumbOf(it),
      });
      groups.set(key, g);
    }

    const sorted = Array.from(groups.values()).sort(
      (a, b) => b.videos.length - a.videos.length || a.channelTitle.localeCompare(b.channelTitle)
    );
    creatorSourcePlaylistId = pid;
    renderCreators(sorted);
    setCreatorStatus(
      `${sorted.length} creator(s) across ${items.length} video(s). Select videos, then move or delete them.`
    );
  } catch (err) {
    setCreatorStatus(asMessage(err), true);
  } finally {
    creatorLoadBtn.disabled = false;
  }
}

/** @param {CreatorGroup[]} groups */
function renderCreators(groups) {
  creatorList.innerHTML = "";
  if (groups.length === 0) {
    setCreatorStatus("That playlist is empty.");
    updateCreatorSelectionSummary();
    return;
  }

  groups.forEach((g) => {
    const group = document.createElement("details");
    group.className = "playlistGroup";

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span>${escapeHtml(g.channelTitle)}</span>
      <span class="groupHeaderRight">
        <span class="groupCount">${g.videos.length}</span>
        <button type="button" class="groupLinkBtn" data-action="select">All</button>
        <span class="dividerDot">·</span>
        <button type="button" class="groupLinkBtn" data-action="deselect">None</button>
      </span>
    `;
    group.appendChild(summary);

    const body = document.createElement("div");
    body.className = "groupBody";
    g.videos.forEach((v) => {
      const row = document.createElement("label");
      row.className = "videoRow";
      row.innerHTML = `
        <input type="checkbox" class="creatorCheckbox" data-item-id="${v.itemId}" data-video-id="${v.videoId}" />
        ${thumbHtml(v.thumb)}
        <span class="title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span>
        ${videoLinkHtml(v.videoId)}
      `;
      body.appendChild(row);
    });
    group.appendChild(body);
    creatorList.appendChild(group);

    const selectBtn = /** @type {HTMLElement} */ (summary.querySelector('[data-action="select"]'));
    const deselectBtn = /** @type {HTMLElement} */ (summary.querySelector('[data-action="deselect"]'));
    selectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      inputsAll(".creatorCheckbox", body).forEach((cb) => (cb.checked = true));
      updateCreatorSelectionSummary();
    });
    deselectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      inputsAll(".creatorCheckbox", body).forEach((cb) => (cb.checked = false));
      updateCreatorSelectionSummary();
    });
  });

  inputsAll(".creatorCheckbox").forEach((cb) => {
    cb.addEventListener("change", updateCreatorSelectionSummary);
  });
  wireVideoLinks(creatorList);
  updateCreatorSelectionSummary();
}

/** @returns {{itemId: string, videoId: string}[]} */
function getCheckedCreatorVideos() {
  return inputsAll(".creatorCheckbox:checked").map((cb) => ({
    itemId: cb.dataset.itemId || "",
    videoId: cb.dataset.videoId || "",
  }));
}

function updateCreatorSelectionSummary() {
  const total = inputsAll(".creatorCheckbox").length;
  const checked = getCheckedCreatorVideos().length;
  creatorSelectionSummary.textContent =
    total === 0 ? "" : `${checked} of ${total} video(s) selected`;
  creatorMoveBtn.disabled = checked === 0;
  creatorDeleteBtn.disabled = checked === 0;
  creatorMoveBtn.textContent = checked === 0 ? "Move selected" : `Move ${checked} selected`;
  creatorDeleteBtn.textContent = checked === 0 ? "Delete selected" : `Delete ${checked} selected`;
}

async function handleCreatorMove() {
  const selected = getCheckedCreatorVideos();
  if (selected.length === 0) return;
  const targetId = creatorMoveTarget.value;
  if (!targetId) {
    setCreatorStatus("Pick a playlist to move the selected videos into.", true);
    return;
  }
  if (targetId === creatorSourcePlaylistId) {
    setCreatorStatus("Target playlist is the same as the source — pick a different one.", true);
    return;
  }

  const targetName = playlists.find((p) => p.id === targetId)?.title || targetId;
  const confirmed = confirm(
    `Move ${selected.length} video(s) into "${targetName}" and remove them from the current playlist?\n\n` +
      `Estimated cost: ~${selected.length * 100} API units (50 to add + 50 to remove, per video). Continue?`
  );
  if (!confirmed) return;

  creatorMoveBtn.disabled = true;
  creatorDeleteBtn.disabled = true;

  const { done, failures, results } = await moveVideosTo(selected, targetId, setCreatorStatus);
  applyResultsToRows("creatorCheckbox", results);
  adjustPlaylistCount(creatorSourcePlaylistId, -done);
  adjustPlaylistCount(targetId, done);
  updateCreatorSelectionSummary();
  setCreatorStatus(
    withFailureNote(`Moved ${done} video(s) into "${targetName}".`, failures, "Creator move failures"),
    failures.length > 0
  );
}

async function handleCreatorDelete() {
  const selected = getCheckedCreatorVideos();
  if (selected.length === 0) return;

  const confirmed = confirm(
    `Permanently remove ${selected.length} video(s) from this playlist?\n\n` +
      `Estimated cost: ~${selected.length * 50} API units. This cannot be undone.`
  );
  if (!confirmed) return;

  creatorMoveBtn.disabled = true;
  creatorDeleteBtn.disabled = true;

  const { done, failures, results } = await deleteVideosFromPlaylist(selected, setCreatorStatus);
  applyResultsToRows("creatorCheckbox", results);
  adjustPlaylistCount(creatorSourcePlaylistId, -done);
  updateCreatorSelectionSummary();
  setCreatorStatus(
    withFailureNote(`Removed ${done} video(s).`, failures, "Creator delete failures"),
    failures.length > 0
  );
}

// ─────────────────────────────────────────────────────────────
// Find videos by duration
// ─────────────────────────────────────────────────────────────
/** Playlist the duration list currently describes (for move/delete). */
let durSourcePlaylistId = "";

async function handleDurationFind() {
  const pid = durPlaylistSelect.value;
  if (!pid) {
    setDurStatus("Pick a playlist first.", true);
    return;
  }

  // Blank means "unbounded on that end"; at least one bound is required
  // or the filter would just list the whole playlist.
  const minRaw = durMinInput.value.trim();
  const maxRaw = durMaxInput.value.trim();
  if (minRaw === "" && maxRaw === "") {
    setDurStatus("Enter a minimum, a maximum, or both.", true);
    return;
  }
  const minSecs = minRaw === "" ? 0 : Number(minRaw) * 60;
  const maxSecs = maxRaw === "" ? Infinity : Number(maxRaw) * 60;
  if (Number.isNaN(minSecs) || Number.isNaN(maxSecs) || minSecs < 0 || maxSecs < 0) {
    setDurStatus("Durations must be positive numbers of minutes.", true);
    return;
  }
  if (minSecs > maxSecs) {
    setDurStatus("Minimum is greater than maximum — swap them.", true);
    return;
  }

  durFindBtn.disabled = true;
  durList.innerHTML = "";
  durSelectionSummary.textContent = "";
  setDurStatus("Reading playlist…");

  try {
    const items = await fetchAllPages("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: pid,
      maxResults: "50",
    });
    setDurStatus(`Looking up runtimes for ${items.length} video(s)…`);
    const durations = await fetchDurations(items.map((i) => i.contentDetails?.videoId));

    /** @type {DurationVideo[]} */
    const matches = [];
    for (const it of items) {
      const vid = it.contentDetails?.videoId;
      const secs = durations.get(vid);
      // Videos with no reported duration (live/unavailable) can't be
      // judged against the filter, so they're left out rather than
      // treated as zero-length and wrongly matched.
      if (secs == null) continue;
      if (secs >= minSecs && secs <= maxSecs) {
        matches.push({
          itemId: it.id,
          videoId: vid,
          title: it.snippet.title,
          thumb: thumbOf(it),
          secs,
        });
      }
    }
    matches.sort((a, b) => b.secs - a.secs);

    durSourcePlaylistId = pid;
    renderDurationMatches(matches);

    const skipped = items.length - durations.size;
    const range =
      maxSecs === Infinity
        ? `longer than ${minRaw}m`
        : minSecs === 0
          ? `shorter than ${maxRaw}m`
          : `between ${minRaw}m and ${maxRaw}m`;
    let msg = `${matches.length} of ${items.length} video(s) are ${range}.`;
    if (skipped > 0) msg += ` ${skipped} skipped (no runtime reported — live or unavailable).`;
    setDurStatus(msg);
  } catch (err) {
    setDurStatus(asMessage(err), true);
  } finally {
    durFindBtn.disabled = false;
  }
}

/** @param {DurationVideo[]} matches */
function renderDurationMatches(matches) {
  durList.innerHTML = "";
  if (matches.length === 0) {
    updateDurSelectionSummary();
    return;
  }

  const body = document.createElement("div");
  body.className = "groupBody plainList";
  matches.forEach((v) => {
    const row = document.createElement("label");
    row.className = "videoRow";
    row.innerHTML = `
      <input type="checkbox" class="durCheckbox" data-item-id="${v.itemId}" data-video-id="${v.videoId}" />
      ${thumbHtml(v.thumb)}
      <span class="title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span>
      ${videoLinkHtml(v.videoId)}
      <span class="date">${formatClock(v.secs)}</span>
    `;
    body.appendChild(row);
  });
  durList.appendChild(body);

  inputsAll(".durCheckbox").forEach((cb) => {
    cb.addEventListener("change", updateDurSelectionSummary);
  });
  wireVideoLinks(durList);
  updateDurSelectionSummary();
}

/** @returns {SelectedVideo[]} */
function getCheckedDurationVideos() {
  return inputsAll(".durCheckbox:checked").map((cb) => ({
    itemId: cb.dataset.itemId || "",
    videoId: cb.dataset.videoId || "",
  }));
}

function updateDurSelectionSummary() {
  const total = inputsAll(".durCheckbox").length;
  const checked = getCheckedDurationVideos().length;
  durSelectionSummary.textContent = total === 0 ? "" : `${checked} of ${total} video(s) selected`;
  durMoveBtn.disabled = checked === 0;
  durDeleteBtn.disabled = checked === 0;
  durMoveBtn.textContent = checked === 0 ? "Move selected" : `Move ${checked} selected`;
  durDeleteBtn.textContent = checked === 0 ? "Delete selected" : `Delete ${checked} selected`;
}

async function handleDurationMove() {
  const selected = getCheckedDurationVideos();
  if (selected.length === 0) return;
  const targetId = durMoveTarget.value;
  if (!targetId) {
    setDurStatus("Pick a playlist to move the selected videos into.", true);
    return;
  }
  if (targetId === durSourcePlaylistId) {
    setDurStatus("Target playlist is the same as the source — pick a different one.", true);
    return;
  }

  const targetName = playlists.find((p) => p.id === targetId)?.title || targetId;
  const ok = confirm(
    `Move ${selected.length} video(s) into "${targetName}" and remove them from the current playlist?\n\n` +
      `Estimated cost: ~${selected.length * 100} API units (50 to add + 50 to remove, per video). Continue?`
  );
  if (!ok) return;

  durMoveBtn.disabled = true;
  durDeleteBtn.disabled = true;

  const { done, failures, results } = await moveVideosTo(selected, targetId, setDurStatus);
  applyResultsToRows("durCheckbox", results);
  adjustPlaylistCount(durSourcePlaylistId, -done);
  adjustPlaylistCount(targetId, done);
  updateDurSelectionSummary();
  setDurStatus(
    withFailureNote(`Moved ${done} video(s) into "${targetName}".`, failures, "Duration move failures"),
    failures.length > 0
  );
}

async function handleDurationDelete() {
  const selected = getCheckedDurationVideos();
  if (selected.length === 0) return;

  const ok = confirm(
    `Permanently remove ${selected.length} video(s) from this playlist?\n\n` +
      `Estimated cost: ~${selected.length * 50} API units. This cannot be undone.`
  );
  if (!ok) return;

  durMoveBtn.disabled = true;
  durDeleteBtn.disabled = true;

  const { done, failures, results } = await deleteVideosFromPlaylist(selected, setDurStatus);
  applyResultsToRows("durCheckbox", results);
  adjustPlaylistCount(durSourcePlaylistId, -done);
  updateDurSelectionSummary();
  setDurStatus(
    withFailureNote(`Removed ${done} video(s).`, failures, "Duration delete failures"),
    failures.length > 0
  );
}

// ─────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Durations
//
// Unlike thumbnails/creators, durations are NOT part of the
// playlistItems payload — they need videos.list. That call takes up to
// 50 ids at once and costs 1 unit per call, so a whole playlist costs
// roughly ceil(n/50) units on top of the reads. Cheap, but not free,
// which is why durations are calculated on demand rather than upfront.
// ─────────────────────────────────────────────────────────────
/**
 * Parse an ISO-8601 duration ("PT4M13S", "P1DT2H") into seconds.
 * Live streams and some unavailable videos report no duration → 0.
 * @param {string | undefined | null} iso
 * @returns {number}
 */
function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || "");
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    Number(d || 0) * 86400 +
    Number(h || 0) * 3600 +
    Number(min || 0) * 60 +
    Math.round(Number(s || 0))
  );
}

/**
 * Clock-style runtime for a single video: 4:13 / 1:02:33.
 * @param {number} secs
 */
function formatClock(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Human total for a whole playlist: "6h 12m" / "48m" / "1d 3h".
 * @param {number} secs
 */
function formatTotal(secs) {
  if (secs <= 0) return "0m";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Look up runtimes for a set of video ids, 50 per request (1 unit each).
 * @param {string[]} videoIds
 * @returns {Promise<Map<string, number>>} videoId → seconds
 */
async function fetchDurations(videoIds) {
  /** @type {Map<string, number>} */
  const out = new Map();
  const unique = Array.from(new Set(videoIds.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const res = await ytFetch("videos", {
      part: "contentDetails",
      id: batch.join(","),
      maxResults: "50",
    });
    for (const v of res.items || []) {
      out.set(v.id, parseIsoDuration(v.contentDetails?.duration));
    }
  }
  return out;
}

/**
 * Rough unit cost of reading a playlist and its durations:
 * one list page + one videos.list call per 50 items.
 * @param {number} itemCount
 */
function durationScanCost(itemCount) {
  return Math.max(1, Math.ceil(itemCount / 50)) * 2;
}

/**
 * Thumbnail URL straight off a playlistItem. This data already comes
 * back in the `snippet` part we request, so showing thumbnails costs no
 * extra API quota. Deleted/private videos have no thumbnails.
 * @param {any} item
 * @returns {string | null}
 */
function thumbOf(item) {
  const t = item?.snippet?.thumbnails;
  return t?.default?.url || t?.medium?.url || null;
}

/**
 * @param {string | null} url
 * @returns {string}
 */
function thumbHtml(url) {
  if (!url) return `<span class="thumb thumbMissing" title="No thumbnail (video may be deleted or private)"></span>`;
  return `<img class="thumb" src="${escapeHtml(url)}" loading="lazy" alt="" />`;
}

/** @param {string} videoId */
function videoLinkHtml(videoId) {
  if (!videoId) return "";
  return `<a class="videoLink" href="${videoUrl(videoId)}" target="_blank" rel="noopener" title="Open on YouTube">↗</a>`;
}

/**
 * Stop clicks on the ↗ links from also toggling the surrounding <label>'s
 * checkbox (the links live inside clickable rows).
 * @param {ParentNode} container
 */
function wireVideoLinks(container) {
  container.querySelectorAll(".videoLink").forEach((a) => {
    a.addEventListener("click", (e) => e.stopPropagation());
  });
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {unknown} err @returns {string} */
function asMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {string} msg @param {boolean} [isError] */
function setStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "#c0392b" : "#666";
}

/** @param {string} msg @param {boolean} [isError] */
function setCombineStatus(msg, isError = false) {
  combineStatus.textContent = msg;
  combineStatus.style.color = isError ? "#c0392b" : "#666";
}

/** @param {string} msg @param {boolean} [isError] */
function setDupStatus(msg, isError = false) {
  dupStatus.textContent = msg;
  dupStatus.style.color = isError ? "#c0392b" : "#666";
}

/** @param {string} msg @param {boolean} [isError] */
function setCreatorStatus(msg, isError = false) {
  creatorStatus.textContent = msg;
  creatorStatus.style.color = isError ? "#c0392b" : "#666";
}

/** @param {string} msg @param {boolean} [isError] */
function setDurStatus(msg, isError = false) {
  durStatus.textContent = msg;
  durStatus.style.color = isError ? "#c0392b" : "#666";
}

// ─────────────────────────────────────────────────────────────
// Wire up
// ─────────────────────────────────────────────────────────────
loginBtn.addEventListener("click", login);
logoutBtn.addEventListener("click", logout);
refreshBtn.addEventListener("click", loadPlaylists);
selectAllBtn.addEventListener("click", () => setAllPlaylistsChecked(true));
deselectAllBtn.addEventListener("click", () => setAllPlaylistsChecked(false));
previewBtn.addEventListener("click", handlePreview);
deleteBtn.addEventListener("click", handleDelete);
resultsSelectAllBtn.addEventListener("click", () => {
  inputsAll(".resultVideoCheckbox").forEach((cb) => (cb.checked = true));
  updateResultsSelectionSummary();
});
resultsDeselectAllBtn.addEventListener("click", () => {
  inputsAll(".resultVideoCheckbox").forEach((cb) => (cb.checked = false));
  updateResultsSelectionSummary();
});
combineBtn.addEventListener("click", handleCombine);
dupScanBtn.addEventListener("click", handleDupScan);
dupDeleteBtn.addEventListener("click", handleDupDelete);
creatorLoadBtn.addEventListener("click", handleLoadCreators);
creatorMoveBtn.addEventListener("click", handleCreatorMove);
creatorDeleteBtn.addEventListener("click", handleCreatorDelete);
durationsBtn.addEventListener("click", handleCalcDurations);
durFindBtn.addEventListener("click", handleDurationFind);
durMoveBtn.addEventListener("click", handleDurationMove);
durDeleteBtn.addEventListener("click", handleDurationDelete);

const redirectUriField = /** @type {HTMLInputElement} */ (byId("redirectUriField"));
const copyRedirectBtn = byId("copyRedirectBtn");
redirectUriField.value = getRedirectUri();
copyRedirectBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(redirectUriField.value);
  copyRedirectBtn.textContent = "Copied!";
  setTimeout(() => (copyRedirectBtn.textContent = "Copy"), 1200);
});

loadQuota();
restoreSession();
