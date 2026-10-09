"use strict";

const OPEN_CONTROLS_KEY = "chrome-stream-layout-open-controls-request-v1";
const OPEN_CONTROLS_MAX_AGE_MS = 10000;
const FRAME_VIEWPORT_NOTIFY_DELAY_MS = 100;
const FRAME_LOAD_TIMEOUT_MS = 20000;
const TILE_PLAYER_SELECTOR = "iframe[data-tile-frame]";
const ICONS = {
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1"></circle><circle cx="16" cy="6" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="18" r="1"></circle><circle cx="16" cy="18" r="1"></circle></svg>',
  maximize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>',
  minimize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M16 21v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>'
};

let state = structuredClone(DEFAULT_STATE);
// Draft URLs never enter persisted state or playback until Apply is pressed.
let draftUrls = null;
let clearedSources = null;
let unusedSourcesExpanded = false;
let saveTimer = 0;
const tileLoads = new WeakMap();
const frameLoadTimers = new Map();
const compatibilityFrames = new Map();
let frameRulesFailed = false;
let focusBeforeControls = null;
let frameViewportNotifyTimer = 0;
let frameViewportNotifyDeadline = 0;
let frameViewportNotifyReason = "layout";
let draggedSlotIndex = null;
let previewSlotIndex = null;
let dragSlotRects = [];
const stage = document.querySelector("#stage");
const fullscreenTarget = document.body;
const controlOverlay = document.querySelector("#controlOverlay");
const streamForm = document.querySelector("#streamForm");
const slotControls = document.querySelector("#slotControls");
const saveStatus = document.querySelector("#saveStatus");
const clearButton = document.querySelector("#clearButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const maximizeLayoutButton = document.querySelector("#maximizeLayoutButton");
const maximizeLayoutLabel = document.querySelector("#maximizeLayoutLabel");
const reloadAllButton = document.querySelector("#reloadAllButton");
const dialogFullscreenButton = document.querySelector("#dialogFullscreenButton");
const closeControlsButton = document.querySelector("#closeControlsButton");
const applyButton = document.querySelector("#applyButton");
const controlsSubtitle = document.querySelector("#controlsSubtitle");
const draftNotice = document.querySelector("#draftNotice");
const pendingStatus = document.querySelector("#pendingStatus");
const discardButton = document.querySelector("#discardButton");
const undoNotice = document.querySelector("#undoNotice");
const undoMessage = document.querySelector("#undoMessage");
const undoButton = document.querySelector("#undoButton");
const playbackNotice = document.querySelector("#playbackNotice");
const appShell = document.querySelector(".app-shell");
const layoutButtons = Array.from(document.querySelectorAll("[data-layout]"));
const fixedViewportObserver = new ResizeObserver(updateFixedViewportScales);

init();

async function init() {
  state = await initializeStorage();
  applyLanguage();
  renderControls();
  bindEvents();
  bindLanguageMenu();
  bindExternalEvents();
  bindViewingControls();
  document.querySelector("#retrySaveButton").addEventListener("click", () => { void retryStorage(); });
  if (storageIssue) showStorageIssue(storageIssue);
  await ensureFrameHeaderRules();
  void renderStage();

  if (consumeOpenControlsRequestFromUrl() || await hasRecentOpenControlsRequest()) {
    openControls();
  }
  await consumeSourceMenuResult();
}

function bindEvents() {
  streamForm.addEventListener("submit", (event) => {
    event.preventDefault();
    syncStateFromForm();
    renderControls();
    void renderStage();
    void persistState(t("applied"));
    if (storageReady) closeControls();
  });

  slotControls.addEventListener("click", (event) => {
    const retryButton = event.target.closest("[data-retry-slot]");
    if (retryButton) {
      void retryTiles([Number(retryButton.dataset.retrySlot)]);
      return;
    }

    const button = event.target.closest("[data-clear-slot]");
    if (!button) return;

    const index = Number(button.dataset.clearSlot);
    const input = slotControls.querySelector(`[data-url-input="${index}"]`);
    if (input) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
  });

  slotControls.addEventListener("input", (event) => {
    const input = event.target.closest("[data-url-input]");
    if (!input) return;

    const index = Number(input.dataset.urlInput);
    draftUrls ||= state.slots.map((slot) => slot.url);
    draftUrls[index] = input.value.trim();
    clearedSources = null;
    updateSlotSourceSummary(index);
    updateSlotTitle(index);
    updateSlotPlaybackStatus(index);
    updateDraftControls();
  });

  slotControls.addEventListener("dragstart", startSlotDrag);
  slotControls.addEventListener("dragover", continueSlotDrag);
  slotControls.addEventListener("drop", finishSlotDrop);
  slotControls.addEventListener("dragend", endSlotDrag);
  slotControls.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-drag-slot]");
    if (!handle || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const index = Number(handle.dataset.dragSlot);
    const target = index + (event.key === "ArrowUp" ? -1 : 1);
    if (target < 0 || target >= SLOT_COUNT) return;
    if (target >= state.layout) unusedSourcesExpanded = true;
    swapSourceSlots(index, target);
    slotControls.querySelector(`[data-drag-slot="${target}"]`)?.focus();
  });

  clearButton.addEventListener("click", () => {
    clearedSources = { slots: structuredClone(state.slots), draftUrls: draftUrls?.slice() || null };
    state.slots = state.slots.map(() => ({ url: "", title: "" }));
    draftUrls = null;
    renderControls();
    void renderStage();
    void persistState(t("cleared"));
    undoButton.focus();
  });

  undoButton.addEventListener("click", () => {
    if (!clearedSources) return;
    state.slots = clearedSources.slots;
    draftUrls = clearedSources.draftUrls;
    clearedSources = null;
    renderControls();
    void renderStage();
    void persistState(t("restored"));
    clearButton.focus();
  });

  discardButton.addEventListener("click", () => {
    draftUrls = null;
    renderControls();
    applyButton.focus();
  });

  closeControlsButton.addEventListener("click", closeControls);

  controlOverlay.addEventListener("click", (event) => {
    if (event.target === controlOverlay) {
      closeControls();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (controlOverlay.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeControls();
    } else if (event.key === "Tab") {
      trapControlsFocus(event);
    }
  });

  reloadAllButton.addEventListener("click", reloadAllTiles);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  dialogFullscreenButton?.addEventListener("click", toggleFullscreen);
  maximizeLayoutButton.addEventListener("click", maximizeLayout);
  document.addEventListener("fullscreenchange", syncFullscreenState);
  window.addEventListener("resize", syncViewportState, { passive: true });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "chrome-stream-layout:youtube-embed-error") {
      fallbackFromYouTubeEmbed(event);
      return;
    }

    if (event.data?.type === "chrome-stream-layout:pointer-activity") {
      showViewTools();
      return;
    }

    if (event.data?.type === "chrome-stream-layout:frame-title") {
      updateTitleFromFrame(event);
    } else if (event.data?.type === "chrome-stream-layout:media-status") {
      updatePlaybackFromFrame(event);
    }
  });

  layoutButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.layout = Number(button.dataset.layout);
      renderControls();
      void renderStage();
      void persistState(t("layoutChanged", { number: state.layout }));
    });
  });

  stage.addEventListener("pointerdown", startResize);
  stage.addEventListener("keydown", resizeWithKeyboard);

  stage.addEventListener("dblclick", (event) => {
    const splitter = event.target.closest("[data-splitter]");
    if (!splitter) return;

    resetCurrentSplit(splitter.dataset.splitter);
    void persistState(t("resetSplit"));
  });
}

function bindExternalEvents() {
  if (!globalThis.chrome?.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEY]) void syncSharedState();
    if (areaName === "local" && changes[OPEN_CONTROLS_KEY]?.newValue) {
      openControls();
    }
  });
}

async function ensureFrameHeaderRules() {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return true;
  }

  try {
    const origins = [...new Set([...compatibilityFrames].filter(([tile]) => tile.isConnected &&
      Number(tile.dataset.tile) < state.layout && tile.dataset.sourceUrl === state.slots[Number(tile.dataset.tile)].url).map(([, origin]) => origin))];
    const response = await chrome.runtime.sendMessage({ type: "ensure-frame-header-rules", origins });
    if (!response?.ok) throw new Error(response?.error || "Frame rules were not installed.");
    frameRulesFailed = false;
  } catch {
    frameRulesFailed = true;
  }
  updatePlaybackNotice();
  return !frameRulesFailed;
}

function updatePlaybackNotice() {
  playbackNotice.hidden = !frameRulesFailed;
  playbackNotice.textContent = frameRulesFailed ? t("rulesFailed") : "";
}

function consumeOpenControlsRequestFromUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has("controls")) {
    return false;
  }

  const shouldOpen = params.get("controls") !== "0";
  params.delete("controls");

  const query = params.toString();
  const cleanUrl = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  history.replaceState(null, "", cleanUrl);

  return shouldOpen;
}

async function hasRecentOpenControlsRequest() {
  if (!globalThis.chrome?.storage?.local) {
    return false;
  }

  try {
    const result = await chrome.storage.local.get(OPEN_CONTROLS_KEY);
    const requestedAt = Number(result[OPEN_CONTROLS_KEY]);
    return Number.isFinite(requestedAt) && Date.now() - requestedAt < OPEN_CONTROLS_MAX_AGE_MS;
  } catch { return false; }
}

function getEditableSlot(index) {
  const saved = state.slots[index];
  const url = draftUrls?.[index] ?? saved.url;
  return { url, title: url === saved.url ? saved.title : "" };
}

function getPendingSourceCount() {
  return state.slots.reduce((count, slot, index) => count + Number(getEditableSlot(index).url !== slot.url), 0);
}

function updateDraftControls() {
  const pending = getPendingSourceCount();
  draftNotice.hidden = !pending;
  pendingStatus.textContent = pending ? t("pendingChanges", { number: pending }) : "";
  applyButton.textContent = pending ? t("applyChanges", { number: pending }) : t("done");
  undoNotice.hidden = !clearedSources;
  undoMessage.textContent = clearedSources ? t("cleared") : "";
  clearButton.disabled = !state.slots.some((slot) => slot.url) &&
    !state.slots.some((_, index) => getEditableSlot(index).url);
}

function renderControls() {
  clearPaneHighlight();
  slotControls.replaceChildren();
  let unusedList = null;
  if (state.layout < SLOT_COUNT) {
    const details = document.createElement("details");
    details.className = "unused-sources";
    details.open = unusedSourcesExpanded;
    const summary = document.createElement("summary");
    summary.textContent = t("unusedSources", { number: SLOT_COUNT - state.layout });
    unusedList = document.createElement("div");
    unusedList.className = "unused-source-list";
    details.append(summary, unusedList);
    details.addEventListener("toggle", () => {
      if (details.isConnected) unusedSourcesExpanded = details.open;
    });
    slotControls.append(details);
  }

  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const slot = getEditableSlot(index);
    const inactive = index >= state.layout;
    const wrapper = document.createElement("div");
    wrapper.className = `slot-control${inactive ? " is-inactive" : ""}`;
    wrapper.dataset.slotTarget = String(index);

    const header = document.createElement("div");
    header.className = "slot-header";
    const position = document.createElement("div");
    position.className = "slot-position";
    position.append(createPaneLocationIcon(index));
    const number = document.createElement("span");
    number.className = "slot-number";
    number.textContent = String(index + 1).padStart(2, "0");
    number.setAttribute("aria-label", t("pane", { number: index + 1 }));
    position.append(number);

    const heading = document.createElement("div");
    heading.className = "slot-heading";
    const title = document.createElement("div");
    title.className = "slot-title";
    title.dataset.slotTitle = String(index);
    title.dir = "auto";
    const source = document.createElement("span");
    source.className = "source-label";
    source.dataset.sourceSummary = String(index);
    heading.append(title);

    const dragHandle = document.createElement("button");
    dragHandle.className = "drag-handle";
    dragHandle.type = "button";
    dragHandle.draggable = true;
    dragHandle.dataset.dragSlot = String(index);
    dragHandle.title = t("reorderHint", { number: index + 1 });
    dragHandle.setAttribute("aria-label", dragHandle.title);
    dragHandle.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    dragHandle.innerHTML = ICONS.grip;
    header.append(position, heading, dragHandle);

    const row = document.createElement("div");
    row.className = "url-row";
    const input = document.createElement("input");
    input.id = `slot-url-${index}`;
    input.type = "text";
    input.inputMode = "url";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", t("pane", { number: index + 1 }) + " URL");
    input.placeholder = "https://example.com/live";
    input.value = slot.url;
    input.dataset.urlInput = String(index);
    const inputShell = document.createElement("div");
    inputShell.className = "url-input-shell";
    inputShell.append(input);

    const clearSlotButton = document.createElement("button");
    clearSlotButton.className = "mini-button";
    clearSlotButton.type = "button";
    clearSlotButton.title = t("clearPane", { number: index + 1 });
    clearSlotButton.setAttribute("aria-label", clearSlotButton.title);
    clearSlotButton.dataset.clearSlot = String(index);
    clearSlotButton.innerHTML = ICONS.clear;
    row.append(inputShell, clearSlotButton);

    const playbackRow = document.createElement("div");
    playbackRow.className = "slot-playback-row";
    const status = document.createElement("span");
    status.className = "source-status";
    status.dataset.statusContainer = String(index);
    const statusIcon = document.createElement("span");
    statusIcon.className = "status-icon";
    statusIcon.dataset.statusIcon = String(index);
    statusIcon.setAttribute("aria-hidden", "true");
    const statusText = document.createElement("span");
    statusText.dataset.playbackStatus = String(index);
    statusText.setAttribute("aria-live", "polite");
    status.append(statusIcon, statusText);
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "retry-button";
    retryButton.dataset.retrySlot = String(index);
    const actions = document.createElement("div");
    actions.className = "slot-actions";
    actions.append(source, retryButton);
    playbackRow.append(status, actions);
    wrapper.append(header, row, playbackRow);
    if (inactive) unusedList.append(wrapper);
    else slotControls.insertBefore(wrapper, slotControls.querySelector(".unused-sources"));
    updateSlotSourceSummary(index);
    updateSlotTitle(index);
    updateSlotPlaybackStatus(index);
  }

  layoutButtons.forEach((button) => {
    const layout = Number(button.dataset.layout);
    const active = layout === state.layout;
    const label = document.createElement("span");
    label.textContent = `${layout} · ${t(`layout${layout}`)}`;
    button.replaceChildren(createLayoutPreview(layout), label);
    button.setAttribute("aria-label", t("layoutOption", { number: layout, name: t(`layout${layout}`) }));
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  syncLanguageMenu();
  updateDraftControls();
}

function createLayoutPreview(layout, activeIndex = null) {
  const regions = {
    2: [[1, 1, 14, 20], [17, 1, 14, 20]],
    3: [[1, 1, 18, 20], [21, 1, 10, 9], [21, 12, 10, 9]],
    4: [[1, 1, 14, 9], [17, 1, 14, 9], [1, 12, 14, 9], [17, 12, 14, 9]]
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 22");
  svg.setAttribute("aria-hidden", "true");
  regions[layout].forEach(([x, y, width, height], index) => {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    Object.entries({ x, y, width, height, rx: 1.5 }).forEach(([key, value]) => rect.setAttribute(key, String(value)));
    if (index === activeIndex) rect.classList.add("is-current");
    svg.append(rect);
  });
  return svg;
}

function createPaneLocationIcon(index) {
  const active = index < state.layout;
  const icon = document.createElement("span");
  icon.className = `pane-location-icon${active ? "" : " is-inactive"}`;
  icon.title = t("panePosition", { number: index + 1, position: getPanePositionLabel(index) });
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", icon.title);
  icon.append(createLayoutPreview(state.layout, active ? index : null));
  return icon;
}

function getPanePositionLabel(index) {
  const positionKeys = {
    2: ["left", "right"],
    3: ["left", "topRight", "bottomRight"],
    4: ["topLeft", "topRight", "bottomLeft", "bottomRight"]
  };
  const key = positionKeys[state.layout]?.[index];
  return key ? t(key) : t("unusedPosition");
}

function updateSlotSourceSummary(index) {
  const summary = slotControls.querySelector(`[data-source-summary="${index}"]`);
  if (summary) {
    const label = getSourceLabel(getEditableSlot(index).url);
    summary.textContent = label;
    summary.title = label;
    summary.dataset.platform = label.toLowerCase();
  }
}

function updateSlotTitle(index) {
  const title = slotControls.querySelector(`[data-slot-title="${index}"]`);
  if (!title) return;

  const slot = getEditableSlot(index);
  title.textContent = slot.title || getSourceLabel(slot.url) || t("newSource");
  title.title = title.textContent;
  title.classList.toggle("is-placeholder", !slot.url);
}

function updateSlotPlaybackStatus(index) {
  const status = slotControls.querySelector(`[data-playback-status="${index}"]`);
  if (!status) return;
  const slot = getEditableSlot(index);
  const pending = slot.url !== state.slots[index].url;
  const tile = stage.querySelector(`[data-tile="${index}"]`);
  const inactive = index >= state.layout;
  const key = pending ? "sourcePending" : inactive ? "idle" : !slot.url.trim() ? "noSource" :
    tile?.dataset.sourceUrl !== slot.url ? "sourcePending" : tile.dataset.status || "sourceLoading";
  status.textContent = t(pending && !slot.url ? "sourceRemoving" : key);
  const failed = ["sourceFailed", "sourceTimeout", "sourceOffline", "sourceRestricted", "sourceMediaError", "sourceRecoveryFailed", "sourceLoadUnconfirmed", "httpOnly", "enterCompleteUrl"].includes(key);
  const tone = pending ? "pending" : sourceStatusTone(key);
  const container = slotControls.querySelector(`[data-status-container="${index}"]`);
  container.dataset.tone = tone;
  const icon = slotControls.querySelector(`[data-status-icon="${index}"]`);
  icon.textContent = tone === "error" ? "!" : pending ? "○" : tone === "loading" ? "" : key === "sourcePlaying" ? "▶" : key === "sourcePaused" ? "Ⅱ" : "·";
  const retry = slotControls.querySelector(`[data-retry-slot="${index}"]`);
  const localPlayer = isLocalLiveSource(parseUrl(slot.url));
  retry.hidden = localPlayer;
  retry.disabled = inactive || pending || !slot.url.trim();
  retry.textContent = t(localPlayer ? "refreshStream" : failed ? "retry" : "reload");
  retry.classList.toggle("is-retry", tone === "error");
  retry.title = pending ? t("applyFirst") : t(localPlayer ? "refreshStreamPane" : failed ? "retryPane" : "reloadPane", { number: index + 1 });
  retry.setAttribute("aria-label", retry.title);
  slotControls.querySelector(`[data-slot-target="${index}"]`).classList.toggle("has-draft", pending);
  slotControls.querySelector(`[data-clear-slot="${index}"]`).disabled = !slot.url;
}

function setTileStatus(tile, status) {
  tile.dataset.status = status;
  syncTileFeedback(tile);
  updateSlotPlaybackStatus(Number(tile.dataset.tile));
}

function startSlotDrag(event) {
  const source = event.target.closest("[data-drag-slot]");
  if (!source) {
    event.preventDefault();
    return;
  }

  draggedSlotIndex = Number(source.dataset.dragSlot);
  dragSlotRects = Array.from(slotControls.querySelectorAll("[data-slot-target]")).filter((element) =>
    element.getClientRects().length && !element.closest("details:not([open])")
  ).map((element) => ({
    index: Number(element.dataset.slotTarget),
    rect: element.getBoundingClientRect()
  }));
  document.body.classList.add("is-reordering");
  source.closest("[data-slot-target]").classList.add("is-dragging");

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedSlotIndex));
}

function continueSlotDrag(event) {
  if (draggedSlotIndex === null) return;

  const targetIndex = getDragTargetIndex(event.clientY);
  if (targetIndex === null) {
    clearSlotSwapPreview();
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  previewSlotSwap(targetIndex);
}

function finishSlotDrop(event) {
  if (draggedSlotIndex === null) return;

  const targetIndex = previewSlotIndex ?? getDragTargetIndex(event.clientY);
  event.preventDefault();
  if (targetIndex === null || targetIndex === draggedSlotIndex) {
    endSlotDrag();
    return;
  }

  const previousIndex = draggedSlotIndex;
  endSlotDrag();
  swapSourceSlots(previousIndex, targetIndex);
}

function swapSourceSlots(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  clearedSources = null;
  [state.slots[fromIndex], state.slots[toIndex]] = [state.slots[toIndex], state.slots[fromIndex]];
  if (draftUrls) [draftUrls[fromIndex], draftUrls[toIndex]] = [draftUrls[toIndex], draftUrls[fromIndex]];
  if (!swapRenderedStageTiles(fromIndex, toIndex)) {
    void renderStage();
  }
  renderControls();
  void persistState(t("positionsSwapped", {
    from: fromIndex + 1,
    to: toIndex + 1
  }));
}

function endSlotDrag() {
  draggedSlotIndex = null;
  dragSlotRects = [];
  document.body.classList.remove("is-reordering");
  slotControls.querySelectorAll(".is-dragging").forEach((element) => {
    element.classList.remove("is-dragging");
  });
  clearSlotSwapPreview();
  clearSlotDropTargets();
}

function getDragTargetIndex(pointerY) {
  if (!Number.isFinite(pointerY) || !dragSlotRects.length) {
    return null;
  }

  const directTarget = dragSlotRects.find(({ rect }) => pointerY >= rect.top && pointerY <= rect.bottom);
  if (directTarget) {
    return directTarget.index;
  }

  return dragSlotRects.reduce((closest, candidate) => {
    const distance = Math.abs(pointerY - (candidate.rect.top + candidate.rect.height / 2));
    return !closest || distance < closest.distance ? { index: candidate.index, distance } : closest;
  }, null)?.index ?? null;
}

function previewSlotSwap(targetIndex) {
  if (targetIndex === previewSlotIndex) return;

  clearSlotSwapPreview();
  if (targetIndex === draggedSlotIndex) return;

  const source = slotControls.querySelector(`[data-slot-target="${draggedSlotIndex}"]`);
  const target = slotControls.querySelector(`[data-slot-target="${targetIndex}"]`);
  const sourceRect = dragSlotRects.find((item) => item.index === draggedSlotIndex)?.rect;
  const targetRect = dragSlotRects.find((item) => item.index === targetIndex)?.rect;
  if (!source || !target || !sourceRect || !targetRect) return;

  previewSlotIndex = targetIndex;
  source.style.setProperty("--drag-preview-y", `${targetRect.top - sourceRect.top}px`);
  target.style.setProperty("--drag-preview-y", `${sourceRect.top - targetRect.top}px`);
  source.classList.add("is-preview-swapping");
  target.classList.add("is-preview-swapping", "is-drop-target");
}

function clearSlotSwapPreview() {
  previewSlotIndex = null;
  slotControls.querySelectorAll(".is-preview-swapping").forEach((element) => {
    element.classList.remove("is-preview-swapping");
    element.style.removeProperty("--drag-preview-y");
  });
  clearSlotDropTargets();
}

function clearSlotDropTargets() {
  slotControls.querySelectorAll(".is-drop-target").forEach((element) => element.classList.remove("is-drop-target"));
}

function swapRenderedStageTiles(fromIndex, toIndex) {
  if (fromIndex >= state.layout || toIndex >= state.layout) {
    return false;
  }

  const fromTile = stage.querySelector(`[data-tile="${fromIndex}"]`);
  const toTile = stage.querySelector(`[data-tile="${toIndex}"]`);
  if (!fromTile || !toTile) {
    return false;
  }

  retargetStageTile(fromTile, toIndex);
  retargetStageTile(toTile, fromIndex);
  updateSlotPlaybackStatus(fromIndex);
  updateSlotPlaybackStatus(toIndex);
  notifyTileFramesOfViewportChange("layout");
  return true;
}

function retargetStageTile(tile, index) {
  Array.from(tile.classList)
    .filter((className) => /^tile-\d+$/.test(className))
    .forEach((className) => tile.classList.remove(className));

  tile.classList.add(`tile-${index + 1}`);
  tile.dataset.tile = String(index);
  tile.dataset.paneLabel = t("pane", { number: index + 1 });

  const shell = tile.querySelector("[data-tile-frame-shell]");
  if (shell) {
    shell.dataset.tileFrameShell = String(index);
  }

  const iframe = tile.querySelector("iframe[data-tile-frame]");
  if (iframe) {
    iframe.dataset.tileFrame = String(index);
    iframe.name = `chrome-stream-layout-pane-${index}`;
    if (iframe.dataset.livePlayer) {
      iframe.removeAttribute("title");
      iframe.setAttribute("aria-label", t("pane", { number: index + 1 }));
    } else {
      iframe.title = t("pane", { number: index + 1 });
    }
  }
  if (iframe?.dataset.livePlayer) updateLiveContext(iframe);
}

async function renderStage() {
  const layout = state.layout;
  const slots = state.slots.slice(0, layout).map((slot) => ({ url: slot.url }));
  const existingTiles = new Map(
    Array.from(stage.querySelectorAll("[data-tile]")).map((tile) => [Number(tile.dataset.tile), tile])
  );
  stage.className = `stage layout-${layout}`;
  fixedViewportObserver.disconnect();
  stage.querySelectorAll("[data-splitter]").forEach((splitter) => splitter.remove());
  stage.querySelectorAll("[data-tile]").forEach((tile) => {
    if (Number(tile.dataset.tile) >= layout) {
      disposeTileLoad(tile);
      tile.remove();
    }
  });

  const loads = slots.map((slot, index) => {
    const existingTile = existingTiles.get(index);
    const tile = existingTile || document.createElement("article");
    tile.classList.add("tile");
    retargetStageTile(tile, index);
    if (!existingTile) stage.append(tile);
    const reuse = tile.dataset.sourceUrl === slot.url;
    if (!reuse) disposeTileLoad(tile);
    tile.dataset.sourceUrl = slot.url;

    if (!slot.url.trim()) {
      tile.replaceChildren(createEmptyState(index));
      setTileStatus(tile, "noSource");
      return;
    }
    if (reuse && tile.querySelector(TILE_PLAYER_SELECTOR)) {
      updateSlotPlaybackStatus(index);
      syncTileFeedback(tile);
      return;
    }
    if (reuse && tileLoads.has(tile)) {
      updateSlotPlaybackStatus(index);
      return tileLoads.get(tile).promise;
    }
    if (reuse && tile.querySelector(".tile-error")) {
      showTileError(tile, slot.url, t(tile.dataset.status));
      updateSlotPlaybackStatus(index);
      return;
    }
    return loadTileSource(tile, slot.url);
  });

  appendSplitters();
  applyStageSizing();
  observeFixedViewportShells();
  for (let index = layout; index < SLOT_COUNT; index += 1) updateSlotPlaybackStatus(index);
  // Each job installs its own result immediately; waiting here is only for
  // callers that explicitly need all current jobs to finish.
  await Promise.all(loads);
  await ensureFrameHeaderRules();
}

function disposeTileLoad(tile) {
  compatibilityFrames.delete(tile);
  disposeLiveRecovery(tile);
  const job = tileLoads.get(tile);
  tileLoads.delete(tile);
  job?.controller.abort();
  tile.querySelectorAll(TILE_PLAYER_SELECTOR).forEach(clearFrameLoadTimer);
  disposeLiveFrames(tile);
  const shell = tile.querySelector("[data-fixed-viewport]");
  if (shell) fixedViewportObserver.unobserve(shell);
}

function loadTileSource(tile, sourceUrl, options = {}) {
  if (isLocalLiveSource(parseUrl(sourceUrl))) return loadLiveTile(tile, sourceUrl, options);
  tile.replaceChildren();
  setTileStatus(tile, "sourceResolving");
  const job = { controller: new AbortController() };
  tileLoads.set(tile, job);
  job.promise = (async () => {
    try {
      const embed = await resolveEmbed(sourceUrl, job.controller.signal);
      if (tileLoads.get(tile) !== job || !tile.isConnected) return;
      if (!embed.ok) {
        showTileError(tile, sourceUrl, embed.message);
        setTileStatus(tile, embed.errorKey || "sourceFailed");
        return;
      }
      if (embed.compatibility) compatibilityFrames.set(tile, new URL(embed.src).origin);
      else compatibilityFrames.delete(tile);
      await ensureFrameHeaderRules();
      if (tileLoads.get(tile) !== job || !tile.isConnected) return;
      const index = Number(tile.dataset.tile);
      tile.replaceChildren(createTileFrame(index, embed, sourceUrl));
      setTileStatus(tile, "sourceLoading");
      const player = tile.querySelector(TILE_PLAYER_SELECTOR);
      startFrameLoadTimer(player);
      if (embed.title) setFrameSourceTitle(player, embed.title);
      if (embed.bilibiliRoomId) void refreshBilibiliFrameTitle(player);
      const shell = tile.querySelector("[data-fixed-viewport]");
      if (shell) fixedViewportObserver.observe(shell);
    } catch (error) {
      if (tileLoads.get(tile) !== job || !tile.isConnected) return;
      const key = ["sourceTimeout", "sourceOffline"].includes(error?.code) ? error.code : "sourceFailed";
      disposeTileLoad(tile);
      showTileError(tile, sourceUrl, t(key));
      setTileStatus(tile, key);
    } finally {
      if (tileLoads.get(tile) === job) tileLoads.delete(tile);
    }
  })();
  return job.promise;
}

function clearFrameLoadTimer(iframe) {
  window.clearTimeout(frameLoadTimers.get(iframe));
  frameLoadTimers.delete(iframe);
}

function startFrameLoadTimer(iframe) {
  clearFrameLoadTimer(iframe);
  frameLoadTimers.set(iframe, window.setTimeout(() => {
    frameLoadTimers.delete(iframe);
    if (!iframe.isConnected) return;
    setTileStatus(iframe.closest("[data-tile]"), "sourceLoadUnconfirmed");
  }, FRAME_LOAD_TIMEOUT_MS));
}

function createTileFrame(index, embed, sourceUrl) {
  const shell = document.createElement("div");
  shell.className = "tile-frame-shell";
  shell.dataset.tileFrameShell = String(index);

  if (embed.fixedViewport) {
    shell.classList.add("is-fixed-viewport");
    shell.dataset.fixedViewport = "true";
    shell.dataset.viewportWidth = String(embed.fixedViewport.width);
    shell.dataset.viewportHeight = String(embed.fixedViewport.height);
    shell.style.setProperty("--frame-width", `${embed.fixedViewport.width}px`);
    shell.style.setProperty("--frame-height", `${embed.fixedViewport.height}px`);
  }

  const iframe = document.createElement("iframe");
  iframe.src = embed.src;
  iframe.title = t("pane", { number: index + 1 });
  iframe.name = `chrome-stream-layout-pane-${index}`;
  iframe.dataset.tileFrame = String(index);
  iframe.dataset.sourceUrl = sourceUrl;
  if (embed.bilibiliRoomId) iframe.dataset.bilibiliRoomId = embed.bilibiliRoomId;
  iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write; web-share";
  iframe.allowFullscreen = true;
  iframe.loading = "eager";
  iframe.referrerPolicy = embed.referrerPolicy || "strict-origin-when-cross-origin";
  iframe.setAttribute("allowfullscreen", "true");
  iframe.addEventListener("load", () => {
    if (!iframe.isConnected) return;
    clearFrameLoadTimer(iframe);
    // A navigation within a frame starts a new page. Ask that page to confirm
    // media state rather than retaining a previous document's "Playing" label.
    setTileStatus(iframe.closest("[data-tile]"), "sourcePageLoaded");
    requestFrameTitle(iframe);
  });

  if (embed.fallbackSrc) {
    iframe.dataset.fallbackSrc = embed.fallbackSrc;
  }

  if (embed.fixedViewport) {
    iframe.width = String(embed.fixedViewport.width);
    iframe.height = String(embed.fixedViewport.height);
  }

  shell.append(iframe);
  return shell;
}

function showTileError(tile, sourceUrl, message) {
  tile.replaceChildren(createErrorState(message, sourceUrl));
}

async function fallbackFromYouTubeEmbed(event) {
  if (event.origin !== "https://www.youtube.com" && event.origin !== "https://www.youtube-nocookie.com") {
    return;
  }

  const iframe = Array.from(stage.querySelectorAll("iframe[data-tile-frame]")).find(
    (candidate) => candidate.contentWindow === event.source
  );
  const fallbackSrc = iframe?.dataset.fallbackSrc;
  if (!fallbackSrc) {
    return;
  }

  delete iframe.dataset.fallbackSrc;
  const tile = iframe.closest("[data-tile]");
  compatibilityFrames.set(tile, new URL(fallbackSrc).origin);
  await ensureFrameHeaderRules();
  if (!iframe.isConnected) return;
  setTileStatus(iframe.closest("[data-tile]"), "sourceLoading");
  startFrameLoadTimer(iframe);
  iframe.src = fallbackSrc;
}

function updatePlaybackFromFrame(event) {
  const statuses = ["sourcePageLoaded", "sourcePlaying", "sourcePaused", "sourceBuffering", "sourceMediaError"];
  if (!statuses.includes(event.data.status) || !/^https?:\/\//.test(event.origin)) return;
  const iframe = Array.from(stage.querySelectorAll("iframe[data-tile-frame]")).find(
    (candidate) => candidate.contentWindow === event.source
  );
  if (!iframe) return;
  clearFrameLoadTimer(iframe);
  setTileStatus(iframe.closest("[data-tile]"), event.data.status);
}

function updateTitleFromFrame(event) {
  const iframe = Array.from(stage.querySelectorAll("iframe[data-tile-frame]")).find(
    (candidate) => candidate.contentWindow === event.source
  );
  if (!iframe) return;

  const title = normalizePageTitle(event.data.title);
  // The official Bilibili player reports its application name, not the room's
  // title. It must not overwrite room metadata, including on iframe load or
  // when reopening the source controls.
  if (iframe.dataset.bilibiliRoomId && isGenericBilibiliTitle(title)) return;
  setFrameSourceTitle(iframe, title);
}

function setFrameSourceTitle(iframe, value) {
  if (!iframe.isConnected) return;
  const index = Number(iframe.dataset.tileFrame ?? iframe.dataset.tileVideo);
  const sourceUrl = iframe.dataset.sourceUrl || "";
  if (!Number.isInteger(index) || state.slots[index]?.url !== sourceUrl) return;

  const title = normalizePageTitle(value);
  if (state.slots[index].title === title) return;

  state.slots[index].title = title;
  updateSlotTitle(index);
}

function isGenericBilibiliTitle(title) {
  return !title || /^Bilibili Live Activity Player$/i.test(title);
}

async function refreshBilibiliFrameTitle(iframe) {
  const roomId = iframe.dataset.bilibiliRoomId;
  const savedTitle = normalizePageTitle(state.slots[Number(iframe.dataset.tileFrame)]?.title);
  if (isGenericBilibiliTitle(savedTitle)) {
    const source = parseUrl(iframe.dataset.sourceUrl);
    setFrameSourceTitle(iframe, `Bilibili · ${(source && getBilibiliLiveRoomId(source)) || roomId}`);
  }
  try {
    const title = await fetchBilibiliLiveTitle(roomId);
    // Resolve the pane's current position after the request: it may have been
    // moved, replaced or removed while room metadata was loading.
    setFrameSourceTitle(iframe, title);
  } catch {
    // Metadata is optional. Preserve a known title (or the room number) and
    // leave playback/status alone; reloading this source retries the lookup.
  }
}

function requestFrameTitle(iframe) {
  if (iframe.dataset.livePlayer) { updateLiveContext(iframe); return; }
  iframe.contentWindow?.postMessage({
    type: "chrome-stream-layout:request-title"
  }, "*");
}

function requestFrameTitles() {
  stage.querySelectorAll("iframe[data-tile-frame]").forEach(requestFrameTitle);
}

function createEmptyState(index) {
  const empty = document.createElement("div");
  empty.className = "tile-empty";
  empty.innerHTML = `<span><strong>${escapeHtml(t("pane", { number: index + 1 }))}</strong>${escapeHtml(t("noSource"))}</span>`;
  empty.prepend(createLayoutPreview(state.layout, index));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "add-source-button";
  button.dataset.sourceAction = "edit";
  button.textContent = t("addSource");
  button.setAttribute("aria-label", t("editPane", { number: index + 1 }));
  empty.append(button);
  return empty;
}

function createErrorState(message, sourceUrl) {
  const error = document.createElement("div");
  error.className = "tile-error";
  error.innerHTML = `<span><strong>${escapeHtml(t("cannotLoad"))}</strong>${escapeHtml(message)}</span>`;
  error.append(createSourceActions(sourceUrl));
  return error;
}

function syncStateFromForm() {
  if (getPendingSourceCount()) clearedSources = null;
  const nextSlots = Array.from({ length: SLOT_COUNT }, (_, index) => {
    const input = slotControls.querySelector(`[data-url-input="${index}"]`);
    const url = input ? input.value.trim() : getEditableSlot(index).url;
    return {
      ...(url === state.slots[index].url ? state.slots[index] : {}),
      url
    };
  });

  state = normalizeState({
    ...state,
    slots: nextSlots
  });
  draftUrls = null;
}

function openControls(index = null) {
  if (controlOverlay.hidden) focusBeforeControls = document.activeElement;
  setLanguageMenu(false);
  if (Number.isInteger(index) && index >= 0 && index < SLOT_COUNT) {
    if (index >= state.layout) unusedSourcesExpanded = true;
  }
  renderControls();
  controlOverlay.hidden = false;
  document.querySelector("#viewTools").hidden = true;
  document.querySelector("#openControlsButton").setAttribute("aria-expanded", "true");
  appShell.inert = true;
  window.setTimeout(() => {
    requestFrameTitles();
    if (controlOverlay.hidden) return;
    const target = Number.isInteger(index) ? slotControls.querySelector(`[data-url-input="${index}"]`) :
      Array.from(slotControls.querySelectorAll("[data-url-input]")).find((element) =>
        element.getClientRects().length && !element.closest("[hidden], details:not([open])"));
    target?.focus();
  }, 0);
}

function closeControls() {
  setLanguageMenu(false);
  controlOverlay.hidden = true;
  clearSourceMenuNotice();
  clearPaneHighlight();
  document.querySelector("#viewTools").hidden = false;
  document.querySelector("#openControlsButton").setAttribute("aria-expanded", "false");
  showViewTools();
  appShell.inert = false;
  document.body.tabIndex = -1;
  const target = focusBeforeControls?.isConnected && !controlOverlay.contains(focusBeforeControls)
    ? focusBeforeControls : document.body;
  target.focus({ preventScroll: true });
}

function trapControlsFocus(event) {
  const controls = Array.from(controlOverlay.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex='0']"))
    .filter((element) => element.getClientRects().length && !element.closest("[hidden]") &&
      (element.matches("summary") || !element.closest("details:not([open])")));
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !controlOverlay.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !controlOverlay.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function reloadAllTiles() {
  void retryTiles(Array.from({ length: state.layout }, (_, index) => index));
}

async function retryTiles(indices, options = {}) {
  const reloadIndices = indices.filter((index) => Number.isInteger(index) && index >= 0 && index < state.layout);
  // Capture the user's retry targets before yielding; layout/URL edits may
  // happen while the worker is preparing the rules.
  const targets = reloadIndices.map((index) => ({ index, url: state.slots[index].url }));
  await ensureFrameHeaderRules();
  const currentIndices = targets.filter(({ index, url }) => index < state.layout && state.slots[index].url === url)
    .map(({ index }) => index);
  if (!currentIndices.length) return;
  currentIndices.forEach((index) => {
    const url = parseUrl(state.slots[index].url);
    if (url && isBilibiliHost(url.hostname)) bilibiliRoomIdCache.delete(getBilibiliLiveRoomId(url));
  });
  void persistState(t("applied"));
  await Promise.all(currentIndices.map((index) => {
    const tile = stage.querySelector(`[data-tile="${index}"]`);
    if (!tile) return;
    if (!isLocalLiveSource(parseUrl(state.slots[index].url)) || tile.dataset.sourceUrl !== state.slots[index].url) {
      disposeTileLoad(tile);
    }
    tile.dataset.sourceUrl = state.slots[index].url;
    if (!tile.dataset.sourceUrl.trim()) {
      tile.replaceChildren(createEmptyState(index));
      setTileStatus(tile, "noSource");
      return;
    }
    return loadTileSource(tile, tile.dataset.sourceUrl, options);
  }));
}

function maximizeLayout() {
  document.body.classList.add("is-layout-maximized");
  const layoutKey = `layout${state.layout}`;
  const sizes = { ...DEFAULT_STATE.sizes[layoutKey] };
  if (state.layout === 3) {
    const { width, height } = stage.getBoundingClientRect();
    // Fit two 16:9 videos to the right column's available height; the main
    // pane uses the remaining width. Account for the 5px separator tracks.
    const rightWidth = Math.max(0, height - 5) / 2 * 16 / 9;
    sizes.col = roundPercent(clamp((1 - rightWidth / Math.max(1, width - 5)) * 100, 18, 82));
  }
  state.sizes[layoutKey] = sizes;
  applyStageSizing();
  closeControls();
  void persistState(t("layoutMaximized"));
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
    return;
  }

  void fullscreenTarget.requestFullscreen().catch(() => {
    syncFullscreenState();
  });
}

function syncFullscreenState() {
  const isFullscreen = Boolean(document.fullscreenElement);
  document.body.classList.toggle("is-browser-fullscreen", isFullscreen);

  fullscreenButton.title = isFullscreen ? t("exitLayoutFullscreen") : t("layoutFullscreen");
  fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
  document.querySelector("#fullscreenIcon").innerHTML = isFullscreen ? ICONS.minimize : ICONS.maximize;
  document.querySelector("#fullscreenLabel").textContent = fullscreenButton.title;
  const viewingButton = document.querySelector("#viewFullscreenButton");
  viewingButton.innerHTML = isFullscreen ? ICONS.minimize : ICONS.maximize;
  viewingButton.title = fullscreenButton.title;
  viewingButton.setAttribute("aria-label", fullscreenButton.title);

  if (dialogFullscreenButton) {
    dialogFullscreenButton.innerHTML = isFullscreen ? ICONS.minimize : ICONS.maximize;
    dialogFullscreenButton.title = fullscreenButton.title;
    dialogFullscreenButton.setAttribute("aria-label", fullscreenButton.title);
  }

  syncViewportState();
}

function syncViewportState() {
  notifyTileFramesOfViewportChange("viewport");
}

function appendSplitters() {
  if (state.layout === 2) {
    stage.append(createSplitter("col"));
    return;
  }

  stage.append(createSplitter("col"));
  stage.append(createSplitter("row"));
}

function createSplitter(axis) {
  const splitter = document.createElement("button");
  splitter.className = `splitter splitter-${axis}`;
  splitter.type = "button";
  splitter.dataset.splitter = axis;
  splitter.title = `${axis === "col" ? t("dragWidth") : t("dragHeight")} · ${t("resetSplitHint")}`;
  splitter.setAttribute("aria-label", splitter.title);
  splitter.setAttribute("aria-orientation", axis === "col" ? "vertical" : "horizontal");
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-valuemin", "18");
  splitter.setAttribute("aria-valuemax", "82");
  const feedback = document.createElement("span");
  feedback.className = "splitter-feedback";
  feedback.setAttribute("aria-hidden", "true");
  const ratio = document.createElement("strong");
  ratio.dataset.splitRatio = "";
  const hint = document.createElement("small");
  hint.textContent = t("resetSplitHint");
  feedback.append(ratio, hint);
  splitter.append(feedback);
  return splitter;
}

function resizeWithKeyboard(event) {
  const splitter = event.target.closest("[data-splitter]");
  if (!splitter) return;
  const axis = splitter.dataset.splitter;
  const direction = axis === "col" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
  const sizes = state.sizes[`layout${state.layout}`];
  let value = sizes[axis];
  if (event.key === "Home") value = 18;
  else if (event.key === "End") value = 82;
  else if (direction[event.key]) value += direction[event.key] * (event.shiftKey ? 10 : 2);
  else return;
  event.preventDefault();
  sizes[axis] = clamp(value, 18, 82);
  applyStageSizing(axis);
  void persistState(t("resized"));
}

function startResize(event) {
  const splitter = event.target.closest("[data-splitter]");
  if (!splitter) {
    return;
  }

  event.preventDefault();
  const axis = splitter.dataset.splitter;
  const layoutKey = `layout${state.layout}`;
  const rect = stage.getBoundingClientRect();

  document.body.classList.add("is-resizing");
  splitter.classList.add("is-dragging");
  splitter.setPointerCapture?.(event.pointerId);

  let resizeFrame = 0;
  let pendingPointerPosition = axis === "col" ? event.clientX : event.clientY;

  const applyPendingResize = () => {
    resizeFrame = 0;

    if (axis === "col") {
      const percent = clamp(((pendingPointerPosition - rect.left) / rect.width) * 100, 18, 82);
      state.sizes[layoutKey].col = roundPercent(percent);
    } else {
      const percent = clamp(((pendingPointerPosition - rect.top) / rect.height) * 100, 18, 82);
      state.sizes[layoutKey].row = roundPercent(percent);
    }

    applyStageSizing(axis, false);
  };

  const onMove = (moveEvent) => {
    pendingPointerPosition = axis === "col" ? moveEvent.clientX : moveEvent.clientY;
    if (!resizeFrame) {
      resizeFrame = window.requestAnimationFrame(applyPendingResize);
    }
  };

  const onEnd = () => {
    if (resizeFrame) {
      window.cancelAnimationFrame(resizeFrame);
      applyPendingResize();
    }

    document.body.classList.remove("is-resizing");
    splitter.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    notifyTileFramesOfViewportChange("layout");
    void persistState(t("resized"));
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd, { once: true });
  window.addEventListener("pointercancel", onEnd, { once: true });
}

function resetCurrentSplit(axis) {
  const layoutKey = `layout${state.layout}`;
  state.sizes[layoutKey][axis] = DEFAULT_STATE.sizes[layoutKey][axis];
  applyStageSizing();
}

function applyStageSizing(axis, notifyFrames = true) {
  const layoutKey = `layout${state.layout}`;
  const sizes = state.sizes[layoutKey];
  const col = sizes.col ?? 50;
  const row = sizes.row ?? 50;

  if (!axis || axis === "col") {
    stage.style.setProperty("--col-a", `${col}fr`);
    stage.style.setProperty("--col-b", `${100 - col}fr`);
  }

  if (!axis || axis === "row") {
    stage.style.setProperty("--row-a", `${row}fr`);
    stage.style.setProperty("--row-b", `${100 - row}fr`);
  }

  stage.querySelectorAll("[data-splitter]").forEach((splitter) => {
    const value = sizes[splitter.dataset.splitter];
    splitter.setAttribute("aria-valuenow", String(value));
    const ratio = `${value}% / ${roundPercent(100 - value)}%`;
    splitter.setAttribute("aria-valuetext", ratio);
    splitter.querySelector("[data-split-ratio]").textContent = ratio;
  });

  if (notifyFrames) {
    notifyTileFramesOfViewportChange("layout");
  }
}

function observeFixedViewportShells() {
  stage.querySelectorAll("[data-fixed-viewport='true']").forEach((shell) => {
    fixedViewportObserver.observe(shell);
  });
}

function updateFixedViewportScales(entries) {
  entries.forEach((entry) => {
    const shell = entry.target;
    const viewportWidth = Number(shell.dataset.viewportWidth) || YESLIVE_THEATER_VIEWPORT.width;
    const viewportHeight = Number(shell.dataset.viewportHeight) || YESLIVE_THEATER_VIEWPORT.height;
    const { width, height } = entry.contentRect;

    if (width <= 0 || height <= 0) {
      return;
    }

    const scale = Math.min(width / viewportWidth, height / viewportHeight);
    const nextScale = String(scale);
    if (shell.style.getPropertyValue("--frame-scale") !== nextScale) {
      shell.style.setProperty("--frame-scale", nextScale);
    }
  });
}

function notifyTileFramesOfViewportChange(reason) {
  frameViewportNotifyReason = reason;
  frameViewportNotifyDeadline = performance.now() + FRAME_VIEWPORT_NOTIFY_DELAY_MS;

  if (!frameViewportNotifyTimer) {
    frameViewportNotifyTimer = window.setTimeout(flushTileFrameViewportChange, FRAME_VIEWPORT_NOTIFY_DELAY_MS);
  }
}

function flushTileFrameViewportChange() {
  const remaining = frameViewportNotifyDeadline - performance.now();
  if (remaining > 0) {
    frameViewportNotifyTimer = window.setTimeout(flushTileFrameViewportChange, remaining);
    return;
  }

  frameViewportNotifyTimer = 0;
  stage.querySelectorAll("iframe[data-tile-frame]").forEach((iframe) => {
    iframe.contentWindow?.postMessage({
      reason: frameViewportNotifyReason,
      type: "chrome-stream-layout:viewport-change"
    }, "*");
  });
}

function applyLanguage() {
  document.documentElement.lang = state.language === "zh-TW" ? "zh-Hant" : "en";
  controlsSubtitle.textContent = t("sourcesAndLayout");
  syncLanguageMenu();
  clearButton.textContent = t("clearAll");
  discardButton.textContent = t("discardChanges");
  undoButton.textContent = t("undo");
  reloadAllButton.title = t("reloadAll");
  reloadAllButton.setAttribute("aria-label", t("reloadAll"));
  closeControlsButton.title = t("close");
  closeControlsButton.setAttribute("aria-label", t("close"));
  maximizeLayoutLabel.textContent = t("maximizeLayout");
  maximizeLayoutButton.title = t("fitWindowHint");
  document.querySelector("#viewTools").setAttribute("aria-label", t("viewingControls"));
  document.querySelector("#openControlsLabel").textContent = t("sourcesAndLayout");
  document.querySelector(".layout-switch").setAttribute("aria-label", t("paneCount"));
  syncFullscreenState();
  updatePlaybackNotice();
  renderSourceMenuNotice();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}
