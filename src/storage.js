"use strict";

let storageReady = false;
let storageIssue = "";
let intentState;
let pendingBase = null;
let saveInFlight = null;
let externalStateChanged = false;
let syncRevision = 0;

async function readState() {
  const result = await chrome.storage.local.get([STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]);
  return result[STORAGE_KEY] || result[PREVIOUS_STORAGE_KEY] || result[LEGACY_STORAGE_KEY];
}

async function initializeStorage() {
  try {
    const saved = normalizeState(await readState());
    storageReady = true;
    intentState = structuredClone(saved);
    return saved;
  } catch {
    storageIssue = "storageReadFailed";
    return normalizeState();
  }
}

function showStorageIssue(key = "") {
  storageIssue = key;
  const notice = document.querySelector("#storageNotice");
  notice.hidden = !key;
  document.querySelector("#storageMessage").textContent = key ? t(key) : "";
  document.querySelector("#retrySaveButton").textContent = t(key === "storageConflict" ? "dismiss" : "retrySave");
  if (key) {
    window.clearTimeout(saveTimer);
    saveStatus.textContent = t(key);
    openControls();
  } else saveStatus.textContent = "";
}

function showSaveStatus(message) {
  window.clearTimeout(saveTimer);
  saveStatus.textContent = message;
  saveTimer = window.setTimeout(() => { saveStatus.textContent = ""; }, 2000);
}

// Keep edited URLs local; untouched inputs follow the shared applied source.
function acceptSharedState(next, keepChangedSources = false) {
  next = normalizeState(next);
  const previous = state;
  next.slots.forEach((slot) => {
    if (!slot.title && slot.url) slot.title = previous.slots.find((old) => old.url === slot.url)?.title || "";
  });
  if (draftUrls || keepChangedSources) {
    draftUrls = previous.slots.map((slot, i) => {
      const draft = draftUrls?.[i] ?? slot.url;
      return draft !== slot.url || (keepChangedSources && slot.url !== next.slots[i].url) ? draft : next.slots[i].url;
    });
  }
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused?.matches("input[type=text]") ? [focused.selectionStart, focused.selectionEnd] : null;
  state = next;
  applyLanguage();
  renderControls();
  const replacement = focusId ? document.getElementById(focusId) : null;
  if (replacement && !replacement.closest("[hidden]")) {
    replacement.focus();
    if (selection) replacement.setSelectionRange(...selection);
  }
  void renderStage();
  stage.querySelectorAll("iframe[data-live-player]").forEach((frame) => {
    const slot = state.slots[Number(frame.dataset.tileFrame)];
    if (slot.url === frame.dataset.sourceUrl) liveHosts.get(frame)?.api?.applyPreferences(slot);
  });
}

function persistState(message) {
  if (!storageReady) { showStorageIssue("storageReadFailed"); return Promise.resolve(false); }
  syncRevision++;
  pendingBase ||= structuredClone(intentState);
  intentState = normalizeState(state);
  if (saveInFlight) return saveInFlight;
  saveInFlight = flushState(message).finally(() => {
    saveInFlight = null;
    if (externalStateChanged && !storageIssue) void syncSharedState();
  });
  return saveInFlight;
}

async function flushState(message) {
  while (pendingBase) {
    const base = pendingBase;
    const desired = structuredClone(intentState);
    pendingBase = null;
    const changes = stateChanges(base, desired);
    const titles = desired.slots.map(({ url, title }) => ({ url, title }));
    const titleChanged = titles.some((slot, i) => slot.title && slot.title !== base.slots[i].title);
    if (!changes.length && !titleChanged) continue;
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "save-settings", changes, titles });
      if (!result?.ok && !result?.conflict) throw new Error("Storage write failed");
    } catch {
      pendingBase = base;
      showStorageIssue("storageWriteFailed");
      return false;
    }
    if (result.conflict) {
      pendingBase = null;
      intentState = normalizeState(result.state);
      acceptSharedState(result.state, true);
      showStorageIssue("storageConflict");
      return false;
    }
    // Retain changes made while this request was in flight, including the next
    // queued save. Incorporate disjoint updates returned by the worker.
    const local = mergeStateChanges(result.state, stateChanges(desired, state), false).state;
    intentState = mergeStateChanges(result.state, stateChanges(desired, intentState), false).state;
    if (pendingBase) pendingBase = normalizeState(result.state);
    if (stateChanges(state, local).length) acceptSharedState(local);
  }
  showStorageIssue();
  showSaveStatus(message);
  return true;
}

async function syncSharedState() {
  externalStateChanged = true;
  const revision = ++syncRevision;
  if (saveInFlight || pendingBase || storageIssue || !storageReady || stateChanges(intentState, state).length) return;
  try {
    const next = normalizeState(await readState());
    if (revision !== syncRevision || saveInFlight || pendingBase || storageIssue || stateChanges(intentState, state).length) return;
    externalStateChanged = false;
    if (!stateChanges(intentState, next).length) return;
    intentState = structuredClone(next);
    acceptSharedState(next);
    showSaveStatus(t("settingsSynced"));
  } catch {
    if (revision === syncRevision && !saveInFlight && !pendingBase) showStorageIssue("storageReadFailed");
  }
}

async function retryStorage() {
  if (storageIssue === "storageConflict") {
    showStorageIssue();
    await syncSharedState();
    return;
  }
  if (!storageReady || storageIssue === "storageReadFailed") {
    const baseline = intentState || normalizeState();
    const edits = state.slots.map((slot, i) => ({
      edited: (draftUrls?.[i] ?? slot.url) !== slot.url || slot.url !== baseline.slots[i].url,
      url: draftUrls?.[i] ?? slot.url
    }));
    storageReady = false;
    const next = await initializeStorage();
    if (!storageReady) { showStorageIssue("storageReadFailed"); return; }
    acceptSharedState(next);
    draftUrls = edits.some((edit) => edit.edited) ? edits.map((edit, i) => edit.edited ? edit.url : next.slots[i].url) : null;
    renderControls();
  }
  showStorageIssue();
  await persistState(t("saved"));
}
