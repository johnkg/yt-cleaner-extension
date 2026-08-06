// CLIENT_ID and SCOPES come from config.js (loaded before this file)

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────
const loginView = document.getElementById("loginView");
const mainView = document.getElementById("mainView");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginError = document.getElementById("loginError");
const loginInfo = document.getElementById("loginInfo");
const playlistList = document.getElementById("playlistList");
const refreshBtn = document.getElementById("refreshBtn");
const selectAllBtn = document.getElementById("selectAllBtn");
const deselectAllBtn = document.getElementById("deselectAllBtn");
const selectionSummary = document.getElementById("selectionSummary");
const daysInput = document.getElementById("daysInput");
const byAddedCheckbox = document.getElementById("byAddedCheckbox");
const previewBtn = document.getElementById("previewBtn");
const deleteBtn = document.getElementById("deleteBtn");
const resultsSection = document.getElementById("resultsSection");
const resultsList = document.getElementById("resultsList");
const resultsSelectAllBtn = document.getElementById("resultsSelectAllBtn");
const resultsDeselectAllBtn = document.getElementById("resultsDeselectAllBtn");
const resultsSelectionSummary = document.getElementById("resultsSelectionSummary");
const statusMsg = document.getElementById("statusMsg");

let accessToken = null;
let playlists = []; // {id, title, count}
let lastMatches = null; // { [playlistId]: [ {itemId, title, date} ] }

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────
function getRedirectUri() {
  return chrome.identity.getRedirectURL();
}

function buildAuthUrl() {
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "token",
    redirect_uri: redirectUri,
    scope: SCOPES,
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function login() {
  loginError.classList.add("hidden");
  loginInfo.classList.remove("hidden");
  loginBtn.disabled = true;

  // The actual OAuth flow runs in the background script (background.js),
  // not here — this popup will very likely close the moment the Google
  // sign-in window takes focus, which would otherwise kill this code
  // mid-flow. If that happens, the background script finishes the job
  // and stores the token anyway; the user just needs to reopen the
  // popup, which restoreSession() below will then pick up.
  chrome.runtime.sendMessage({ type: "LOGIN" }, (response) => {
    loginBtn.disabled = false;
    if (chrome.runtime.lastError) {
      // Most likely cause: the background script isn't running (e.g.
      // it failed to load, or this browser doesn't support the
      // manifest's background configuration). Surface it rather than
      // failing silently.
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
// YouTube API helpers
// ─────────────────────────────────────────────────────────────
async function ytFetch(path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    await logout();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error (${res.status}): ${body}`);
  }
  return res.json();
}

async function ytDelete(path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Delete failed (${res.status}): ${body}`);
  }
}

async function fetchAllPages(path, params) {
  let items = [];
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
      maxResults: 50,
    });
    playlists = items.map((p) => ({
      id: p.id,
      title: p.snippet.title,
      count: p.contentDetails.itemCount,
    }));
    renderPlaylists();
  } catch (err) {
    playlistList.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function renderPlaylists() {
  if (playlists.length === 0) {
    playlistList.innerHTML = `<p class="muted">No playlists found.</p>`;
    selectionSummary.textContent = "";
    return;
  }
  playlistList.innerHTML = "";
  playlists.forEach((p) => {
    const row = document.createElement("label");
    row.className = "playlistItem";
    row.innerHTML = `
      <input type="checkbox" class="playlistCheckbox" value="${p.id}" checked />
      <span class="title" title="${p.title}">${p.title}</span>
      <span class="count">${p.count}</span>
    `;
    playlistList.appendChild(row);
  });
  document.querySelectorAll(".playlistCheckbox").forEach((cb) => {
    cb.addEventListener("change", updateSelectionSummary);
  });
  updateSelectionSummary();
}

function getSelectedPlaylistIds() {
  return Array.from(document.querySelectorAll(".playlistCheckbox:checked")).map(
    (el) => el.value
  );
}

function setAllPlaylistsChecked(checked) {
  document.querySelectorAll(".playlistCheckbox").forEach((cb) => {
    cb.checked = checked;
  });
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const total = document.querySelectorAll(".playlistCheckbox").length;
  const selected = getSelectedPlaylistIds().length;
  selectionSummary.textContent =
    total === 0 ? "" : `${selected} of ${total} playlist(s) selected`;
}

async function getOldItemsForPlaylist(playlistId, cutoffDate, byAdded) {
  const items = await fetchAllPages("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: 50,
  });

  return items
    .map((item) => {
      const dateStr = byAdded
        ? item.snippet.publishedAt
        : item.contentDetails.videoPublishedAt || item.snippet.publishedAt;
      return {
        itemId: item.id,
        title: item.snippet.title,
        date: dateStr,
      };
    })
    .filter((v) => v.date && new Date(v.date) < cutoffDate);
}

// ─────────────────────────────────────────────────────────────
// Preview / Delete
// ─────────────────────────────────────────────────────────────
async function runScan() {
  const days = parseInt(daysInput.value, 10);
  if (!days || days < 1) {
    setStatus("Enter a valid number of days.", true);
    return null;
  }
  const selectedIds = getSelectedPlaylistIds();
  if (selectedIds.length === 0) {
    setStatus("Select at least one playlist.", true);
    return null;
  }

  const cutoffDate = new Date(Date.now() - days * 86400000);
  const byAdded = byAddedCheckbox.checked;
  const matches = {};

  setStatus("Scanning playlists…");
  for (const pid of selectedIds) {
    try {
      matches[pid] = await getOldItemsForPlaylist(pid, cutoffDate, byAdded);
    } catch (err) {
      setStatus(err.message, true);
      return null;
    }
  }
  return matches;
}

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
      <span>${playlistTitle}</span>
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
        <span class="title" title="${v.title}">${v.title}</span>
        <span class="date">${dateShort}</span>
      `;
      body.appendChild(row);
    });
    group.appendChild(body);
    resultsList.appendChild(group);

    summary.querySelector('[data-action="select"]').addEventListener("click", (e) => {
      e.preventDefault();
      body.querySelectorAll(".resultVideoCheckbox").forEach((cb) => (cb.checked = true));
      updateResultsSelectionSummary();
    });
    summary.querySelector('[data-action="deselect"]').addEventListener("click", (e) => {
      e.preventDefault();
      body.querySelectorAll(".resultVideoCheckbox").forEach((cb) => (cb.checked = false));
      updateResultsSelectionSummary();
    });
  });

  if (total === 0) {
    resultsList.innerHTML = `<p class="muted">No videos matched the threshold.</p>`;
    resultsSelectionSummary.textContent = "";
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Delete matched videos";
    return;
  }

  document.querySelectorAll(".resultVideoCheckbox").forEach((cb) => {
    cb.addEventListener("change", updateResultsSelectionSummary);
  });

  setStatus(`Found ${total} video(s) older than the threshold. Uncheck any you'd like to keep, then click Delete.`);
  updateResultsSelectionSummary();
}

function getCheckedResultVideos() {
  return Array.from(document.querySelectorAll(".resultVideoCheckbox:checked")).map((cb) => ({
    playlistId: cb.dataset.playlistId,
    itemId: cb.dataset.itemId,
  }));
}

function updateResultsSelectionSummary() {
  const totalCheckboxes = document.querySelectorAll(".resultVideoCheckbox").length;
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
  const failures = [];

  for (const { playlistId, itemId } of selected) {
    try {
      await ytDelete("playlistItems", { id: itemId });
      removedCount++;
      // Remove this item from lastMatches so it doesn't reappear in the list
      if (lastMatches && lastMatches[playlistId]) {
        lastMatches[playlistId] = lastMatches[playlistId].filter((v) => v.itemId !== itemId);
      }
    } catch (err) {
      failures.push(err.message);
    }
  }

  if (lastMatches) {
    renderResults(lastMatches);
  }

  const remaining = lastMatches
    ? Object.values(lastMatches).reduce((n, v) => n + v.length, 0)
    : 0;
  let msg = `Removed ${removedCount} video(s).`;
  if (remaining > 0) msg += ` ${remaining} kept (unchecked).`;
  if (failures.length > 0) msg += ` ${failures.length} failed — see console.`;
  if (failures.length > 0) console.error("Deletion failures:", failures);
  setStatus(msg, failures.length > 0);

  loadPlaylists(); // refresh counts
}

function setStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "#c0392b" : "#666";
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
  document.querySelectorAll(".resultVideoCheckbox").forEach((cb) => (cb.checked = true));
  updateResultsSelectionSummary();
});
resultsDeselectAllBtn.addEventListener("click", () => {
  document.querySelectorAll(".resultVideoCheckbox").forEach((cb) => (cb.checked = false));
  updateResultsSelectionSummary();
});

const redirectUriField = document.getElementById("redirectUriField");
const copyRedirectBtn = document.getElementById("copyRedirectBtn");
redirectUriField.value = getRedirectUri();
copyRedirectBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(redirectUriField.value);
  copyRedirectBtn.textContent = "Copied!";
  setTimeout(() => (copyRedirectBtn.textContent = "Copy"), 1200);
});

restoreSession();
