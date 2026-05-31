"use strict";

const STORAGE_KEY = "chrome-stream-layout-state-v1";
const OPEN_CONTROLS_KEY = "chrome-stream-layout-open-controls-request-v1";
const OPEN_CONTROLS_MAX_AGE_MS = 10000;
const PREVIOUS_STORAGE_KEY = "live-mosaic-state-v2";
const LEGACY_STORAGE_KEY = "live-mosaic-state-v1";
const SLOT_COUNT = 4;
const DEFAULT_STATE = {
  layout: 4,
  sizes: {
    layout2: { col: 50 },
    layout3: { col: 66, row: 50 },
    layout4: { col: 50, row: 50 }
  },
  slots: Array.from({ length: SLOT_COUNT }, () => ({ url: "" }))
};

const ICONS = {
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.4 6.4M3 12A9 9 0 0 1 18.4 5.6"></path><path d="M18 2v4h4M6 22v-4H2"></path></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>',
  maximize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>',
  minimize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M16 21v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>'
};

let state = structuredClone(DEFAULT_STATE);
let focusedTile = null;
let saveTimer = 0;

const stage = document.querySelector("#stage");
const controlOverlay = document.querySelector("#controlOverlay");
const streamForm = document.querySelector("#streamForm");
const slotControls = document.querySelector("#slotControls");
const saveStatus = document.querySelector("#saveStatus");
const clearButton = document.querySelector("#clearButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const reloadAllButton = document.querySelector("#reloadAllButton");
const openControlsButton = document.querySelector("#openControlsButton");
const closeControlsButton = document.querySelector("#closeControlsButton");
const layoutButtons = Array.from(document.querySelectorAll("[data-layout]"));

init();

async function init() {
  state = normalizeState(await readState());
  renderControls();
  renderStage();
  bindEvents();
  bindExternalEvents();

  if (consumeOpenControlsRequestFromUrl() || await hasRecentOpenControlsRequest()) {
    openControls();
  }
}

function bindEvents() {
  streamForm.addEventListener("submit", (event) => {
    event.preventDefault();
    syncStateFromForm();
    renderControls();
    renderStage();
    void persistState("Applied");
    closeControls();
  });

  slotControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-clear-slot]");
    if (!button) return;

    const index = Number(button.dataset.clearSlot);
    const input = slotControls.querySelector(`[data-url-input="${index}"]`);
    if (input) {
      input.value = "";
      input.focus();
    }
  });

  clearButton.addEventListener("click", () => {
    state.slots = state.slots.map(() => ({ url: "" }));
    renderControls();
    renderStage();
    void persistState("Cleared");
  });

  openControlsButton.addEventListener("click", openControls);
  closeControlsButton.addEventListener("click", closeControls);

  controlOverlay.addEventListener("click", (event) => {
    if (event.target === controlOverlay) {
      closeControls();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (focusedTile !== null) {
        toggleTileFocus(focusedTile);
        return;
      }

      if (!controlOverlay.hidden) {
        closeControls();
      }
    }
  });

  reloadAllButton.addEventListener("click", reloadAllTiles);
  fullscreenButton.addEventListener("click", toggleFullscreen);

  layoutButtons.forEach((button) => {
    button.addEventListener("click", () => {
      syncStateFromForm();
      state.layout = Number(button.dataset.layout);
      focusedTile = focusedTile !== null && focusedTile < state.layout ? focusedTile : null;
      renderControls();
      renderStage();
      void persistState(`Layout ${state.layout}`);
    });
  });

  stage.addEventListener("click", (event) => {
    const focusButton = event.target.closest("[data-focus-tile]");
    if (focusButton) {
      toggleTileFocus(Number(focusButton.dataset.focusTile));
      return;
    }

    const reloadButton = event.target.closest("[data-reload-tile]");
    if (reloadButton) {
      reloadTile(Number(reloadButton.dataset.reloadTile));
      return;
    }

    const externalButton = event.target.closest("[data-open-source]");
    if (externalButton) {
      openSource(Number(externalButton.dataset.openSource));
    }
  });

  stage.addEventListener("pointerdown", startResize);

  stage.addEventListener("dblclick", (event) => {
    const splitter = event.target.closest("[data-splitter]");
    if (!splitter) return;

    resetCurrentSplit(splitter.dataset.splitter);
    void persistState("Reset split");
  });
}

function bindExternalEvents() {
  if (!globalThis.chrome?.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[OPEN_CONTROLS_KEY]?.newValue) {
      openControls();
    }
  });
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

  const result = await chrome.storage.local.get(OPEN_CONTROLS_KEY);
  const requestedAt = Number(result[OPEN_CONTROLS_KEY]);

  return Number.isFinite(requestedAt) && Date.now() - requestedAt < OPEN_CONTROLS_MAX_AGE_MS;
}

function renderControls() {
  slotControls.replaceChildren();

  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const slot = state.slots[index];
    const disabled = index >= state.layout;
    const wrapper = document.createElement("div");
    wrapper.className = `slot-control${disabled ? " is-disabled" : ""}`;

    const labelRow = document.createElement("div");
    labelRow.className = "slot-label-row";

    const label = document.createElement("label");
    label.htmlFor = `slot-url-${index}`;
    label.textContent = `Pane ${index + 1}`;

    const status = document.createElement("span");
    status.textContent = disabled ? "Idle" : getSourceLabel(slot.url);

    labelRow.append(label, status);

    const row = document.createElement("div");
    row.className = "url-row";

    const input = document.createElement("input");
    input.id = `slot-url-${index}`;
    input.type = "url";
    input.inputMode = "url";
    input.placeholder = "https://example.com/video";
    input.value = slot.url;
    input.dataset.urlInput = String(index);

    const clearSlotButton = document.createElement("button");
    clearSlotButton.className = "mini-button";
    clearSlotButton.type = "button";
    clearSlotButton.title = "Clear";
    clearSlotButton.setAttribute("aria-label", `Clear pane ${index + 1}`);
    clearSlotButton.dataset.clearSlot = String(index);
    clearSlotButton.innerHTML = ICONS.clear;

    row.append(input, clearSlotButton);
    wrapper.append(labelRow, row);
    slotControls.append(wrapper);
  }

  layoutButtons.forEach((button) => {
    const active = Number(button.dataset.layout) === state.layout;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderStage() {
  stage.className = `stage layout-${state.layout}`;
  stage.replaceChildren();
  focusedTile = focusedTile !== null && focusedTile < state.layout ? focusedTile : null;

  for (let index = 0; index < state.layout; index += 1) {
    const slot = state.slots[index];
    const tile = document.createElement("article");
    tile.className = `tile tile-${index + 1}`;
    tile.dataset.tile = String(index);

    if (!slot.url.trim()) {
      tile.append(createEmptyState(index));
      stage.append(tile);
      continue;
    }

    const embed = resolveEmbed(slot.url);
    tile.append(createTileToolbar(index));

    if (!embed.ok) {
      tile.append(createErrorState(embed.message));
      stage.append(tile);
      continue;
    }

    const badge = document.createElement("div");
    badge.className = "tile-badge";
    badge.textContent = embed.label;

    const iframe = document.createElement("iframe");
    iframe.src = embed.src;
    iframe.title = `Pane ${index + 1}`;
    iframe.dataset.tileFrame = String(index);
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; clipboard-write; web-share";
    iframe.loading = "eager";
    iframe.referrerPolicy = embed.referrerPolicy || "strict-origin-when-cross-origin";

    tile.append(badge, iframe);
    stage.append(tile);
  }

  appendSplitters();
  applyStageSizing();
  applyFocusState();
}

function createEmptyState(index) {
  const empty = document.createElement("div");
  empty.className = "tile-empty";
  empty.innerHTML = `<span><strong>Pane ${index + 1}</strong>No source set</span>`;
  return empty;
}

function createErrorState(message) {
  const error = document.createElement("div");
  error.className = "tile-error";
  error.innerHTML = `<span><strong>Cannot load</strong>${escapeHtml(message)}</span>`;
  return error;
}

function createTileToolbar(index) {
  const toolbar = document.createElement("div");
  toolbar.className = "tile-toolbar";

  const focus = document.createElement("button");
  focus.className = "tile-action";
  focus.type = "button";
  focus.title = "Pane fullscreen";
  focus.setAttribute("aria-label", `Pane fullscreen ${index + 1}`);
  focus.dataset.focusTile = String(index);
  focus.innerHTML = ICONS.maximize;

  const reload = document.createElement("button");
  reload.className = "tile-action";
  reload.type = "button";
  reload.title = "Reload";
  reload.setAttribute("aria-label", `Reload pane ${index + 1}`);
  reload.dataset.reloadTile = String(index);
  reload.innerHTML = ICONS.reload;

  const external = document.createElement("button");
  external.className = "tile-action";
  external.type = "button";
  external.title = "Open source";
  external.setAttribute("aria-label", `Open source ${index + 1}`);
  external.dataset.openSource = String(index);
  external.innerHTML = ICONS.external;

  toolbar.append(focus, reload, external);
  return toolbar;
}

function syncStateFromForm() {
  const nextSlots = Array.from({ length: SLOT_COUNT }, (_, index) => {
    const input = slotControls.querySelector(`[data-url-input="${index}"]`);
    return { url: input ? input.value.trim() : state.slots[index].url };
  });

  state = normalizeState({
    ...state,
    slots: nextSlots
  });
}

function openControls() {
  renderControls();
  controlOverlay.hidden = false;
  const firstInput = slotControls.querySelector("input");
  window.setTimeout(() => firstInput?.focus(), 0);
}

function closeControls() {
  controlOverlay.hidden = true;
  openControlsButton.focus();
}

function reloadAllTiles() {
  Array.from(stage.querySelectorAll("iframe[data-tile-frame]")).forEach((iframe) => {
    iframe.src = iframe.src;
  });
}

function reloadTile(index) {
  const iframe = stage.querySelector(`iframe[data-tile-frame="${index}"]`);
  if (iframe) {
    iframe.src = iframe.src;
  }
}

function openSource(index) {
  const url = state.slots[index]?.url;
  if (!url) return;

  if (globalThis.chrome?.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }

  void document.documentElement.requestFullscreen();
}

function toggleTileFocus(index) {
  focusedTile = focusedTile === index ? null : index;
  applyFocusState();
}

function applyFocusState() {
  const isFocused = focusedTile !== null;
  stage.classList.toggle("is-focused", isFocused);
  stage.dataset.focusedTile = isFocused ? String(focusedTile) : "";

  stage.querySelectorAll(".tile").forEach((tile) => {
    const active = Number(tile.dataset.tile) === focusedTile;
    tile.classList.toggle("is-focused-tile", active);
    tile.classList.toggle("is-hidden-by-focus", isFocused && !active);
  });

  stage.querySelectorAll("[data-focus-tile]").forEach((button) => {
    const active = Number(button.dataset.focusTile) === focusedTile;
    button.title = active ? "Exit pane fullscreen" : "Pane fullscreen";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = active ? ICONS.minimize : ICONS.maximize;
  });
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
  splitter.title = axis === "col" ? "Drag to resize width" : "Drag to resize height";
  splitter.setAttribute("aria-label", splitter.title);
  splitter.setAttribute("aria-orientation", axis === "col" ? "vertical" : "horizontal");
  return splitter;
}

function startResize(event) {
  const splitter = event.target.closest("[data-splitter]");
  if (!splitter || focusedTile !== null) {
    return;
  }

  event.preventDefault();
  const axis = splitter.dataset.splitter;
  const layoutKey = `layout${state.layout}`;
  const rect = stage.getBoundingClientRect();

  document.body.classList.add("is-resizing");
  splitter.setPointerCapture?.(event.pointerId);

  const onMove = (moveEvent) => {
    if (axis === "col") {
      const percent = clamp(((moveEvent.clientX - rect.left) / rect.width) * 100, 18, 82);
      state.sizes[layoutKey].col = roundPercent(percent);
    } else {
      const percent = clamp(((moveEvent.clientY - rect.top) / rect.height) * 100, 18, 82);
      state.sizes[layoutKey].row = roundPercent(percent);
    }

    applyStageSizing();
  };

  const onEnd = () => {
    document.body.classList.remove("is-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    void persistState("Resized");
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

function applyStageSizing() {
  const layoutKey = `layout${state.layout}`;
  const sizes = state.sizes[layoutKey];
  const col = sizes.col ?? 50;
  const row = sizes.row ?? 50;

  stage.style.setProperty("--col-a", `${col}fr`);
  stage.style.setProperty("--col-b", `${100 - col}fr`);
  stage.style.setProperty("--row-a", `${row}fr`);
  stage.style.setProperty("--row-b", `${100 - row}fr`);
}

function resolveEmbed(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) {
    return { ok: false, message: "Enter a complete URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, message: "Only http and https sources are supported." };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (isYouTubeHost(hostname)) {
    return resolveYouTube(parsed);
  }

  if (isTwitchHost(hostname)) {
    return resolveTwitch(parsed);
  }

  if (isBilibiliHost(hostname)) {
    return resolveBilibili(parsed);
  }

  if (isHuyaHost(hostname)) {
    return resolveHuya(parsed);
  }

  if (isDirectMediaUrl(parsed)) {
    return {
      ok: true,
      src: getPlayerUrl(parsed.href),
      label: getMediaLabel(parsed),
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  return {
    ok: true,
    src: parsed.href,
    label: hostname || "Web source",
    referrerPolicy: "strict-origin-when-cross-origin"
  };
}

function resolveYouTube(url) {
  const videoId = getYouTubeVideoId(url);
  const src = videoId ? getYouTubeWatchUrl(url, videoId) : url.href;

  return {
    ok: true,
    src,
    label: "YouTube",
    referrerPolicy: "strict-origin-when-cross-origin"
  };
}

function resolveTwitch(url) {
  const path = splitPath(url);
  const playerVideo = sanitizeTwitchVideoId(url.searchParams.get("video"));
  const playerChannel = sanitizeTwitchChannel(url.searchParams.get("channel"));
  let src = url.href;
  let label = "Twitch page";

  if (url.hostname.toLowerCase() === "player.twitch.tv" && playerVideo) {
    src = `https://www.twitch.tv/videos/${encodeURIComponent(playerVideo)}`;
    label = "Twitch VOD";
  } else if (url.hostname.toLowerCase() === "player.twitch.tv" && playerChannel) {
    src = `https://www.twitch.tv/${encodeURIComponent(playerChannel)}`;
    label = "Twitch";
  } else if (path[0] === "videos") {
    const video = sanitizeTwitchVideoId(path[1]);
    if (video) {
      src = `https://www.twitch.tv/videos/${encodeURIComponent(video)}`;
      label = "Twitch VOD";
    }
  } else if (path[0] === "embed" && path[1]) {
    const channel = sanitizeTwitchChannel(path[1]);
    if (channel) {
      src = `https://www.twitch.tv/${encodeURIComponent(channel)}`;
      label = "Twitch";
    }
  } else {
    const channel = sanitizeTwitchChannel(path[0] || url.searchParams.get("channel"));
    if (channel) {
      src = `https://www.twitch.tv/${encodeURIComponent(channel)}`;
      label = "Twitch";
    }
  }

  return {
    ok: true,
    src,
    label,
    referrerPolicy: "strict-origin-when-cross-origin"
  };
}

function resolveBilibili(url) {
  const roomId = getBilibiliRoomId(url);
  if (!roomId) {
    return {
      ok: true,
      src: url.href,
      label: "Bilibili page",
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  return {
    ok: true,
    src: `https://live.bilibili.com/${encodeURIComponent(roomId)}`,
    label: "Bilibili",
    referrerPolicy: "strict-origin-when-cross-origin"
  };
}

function resolveHuya(url) {
  const path = splitPath(url);

  if (url.hostname.toLowerCase() === "liveshare.huya.com" && path[0] === "iframe" && path[1]) {
    return {
      ok: true,
      src: `https://liveshare.huya.com/iframe/${encodeURIComponent(path[1])}`,
      label: "Huya",
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  const room = path[0];
  if (!room || ["g", "l", "r"].includes(room)) {
    return {
      ok: true,
      src: url.href,
      label: "Huya page",
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  return {
    ok: true,
    src: `https://liveshare.huya.com/iframe/${encodeURIComponent(room)}`,
    label: "Huya",
    referrerPolicy: "strict-origin-when-cross-origin"
  };
}

function getYouTubeVideoId(url) {
  const path = splitPath(url);

  if (url.hostname.toLowerCase() === "youtu.be") {
    return cleanVideoId(path[0]);
  }

  if (path[0] === "watch") {
    return cleanVideoId(url.searchParams.get("v"));
  }

  if (["embed", "live", "shorts"].includes(path[0])) {
    return cleanVideoId(path[1]);
  }

  return cleanVideoId(url.searchParams.get("v"));
}

function getYouTubeWatchUrl(sourceUrl, videoId) {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);

  for (const key of ["list", "index", "t"]) {
    const value = sourceUrl.searchParams.get(key);
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  url.searchParams.set("autoplay", "1");
  url.searchParams.set("mute", "1");
  return url.href;
}

function getBilibiliRoomId(url) {
  const path = splitPath(url);
  const fromQuery = url.searchParams.get("roomId") || url.searchParams.get("room_id") || url.searchParams.get("cid");

  if (fromQuery && /^[a-zA-Z0-9_-]+$/.test(fromQuery)) {
    return fromQuery;
  }

  if (url.hostname.toLowerCase() === "live.bilibili.com" && path[0] && /^[a-zA-Z0-9_-]+$/.test(path[0])) {
    return path[0];
  }

  return "";
}

function getPlayerUrl(src) {
  const params = new URLSearchParams({ src });
  if (globalThis.chrome?.runtime?.getURL) {
    return `${chrome.runtime.getURL("player.html")}?${params.toString()}`;
  }

  return `player.html?${params.toString()}`;
}

function getSourceLabel(rawUrl) {
  if (!rawUrl.trim()) return "";

  const parsed = parseUrl(rawUrl);
  if (!parsed) return "URL";

  const hostname = parsed.hostname.toLowerCase();
  if (isYouTubeHost(hostname)) return "YouTube";
  if (isTwitchHost(hostname)) return "Twitch";
  if (isBilibiliHost(hostname)) return "Bilibili";
  if (isHuyaHost(hostname)) return "Huya";
  if (isDirectMediaUrl(parsed)) return getMediaLabel(parsed);
  return hostname || "URL";
}

function getMediaLabel(url) {
  const extension = getPathExtension(url);
  return extension ? `Video .${extension}` : "Video";
}

function parseUrl(rawUrl) {
  const value = rawUrl.trim();
  if (!value) return null;

  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

function splitPath(url) {
  return url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

function cleanVideoId(value) {
  if (!value) return "";
  const match = String(value).match(/^[a-zA-Z0-9_-]{6,}$/);
  return match ? match[0] : "";
}

function sanitizeTwitchChannel(value) {
  if (!value) return "";
  const match = String(value).match(/^[a-zA-Z0-9_]{3,25}$/);
  return match ? match[0] : "";
}

function sanitizeTwitchVideoId(value) {
  if (!value) return "";
  const match = String(value).match(/^v?(\d+)$/i);
  return match ? match[1] : "";
}

function isDirectMediaUrl(url) {
  return /^(mp4|m4v|webm|ogv|ogg|mov|m3u8|mpd)$/i.test(getPathExtension(url));
}

function getPathExtension(url) {
  const path = decodeURIComponent(url.pathname || "").toLowerCase();
  const match = path.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function isYouTubeHost(hostname) {
  return hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname.endsWith(".youtube-nocookie.com");
}

function isTwitchHost(hostname) {
  return hostname === "twitch.tv" || hostname.endsWith(".twitch.tv") || hostname === "player.twitch.tv";
}

function isBilibiliHost(hostname) {
  return hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");
}

function isHuyaHost(hostname) {
  return hostname === "huya.com" || hostname.endsWith(".huya.com");
}

async function readState() {
  if (globalThis.chrome?.storage?.local) {
    const result = await chrome.storage.local.get([STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]);
    return result[STORAGE_KEY] || result[PREVIOUS_STORAGE_KEY] || result[LEGACY_STORAGE_KEY];
  }

  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY)) || JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return null;
  }
}

async function persistState(message) {
  window.clearTimeout(saveTimer);
  saveStatus.textContent = message;

  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  saveTimer = window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1300);
}

function normalizeState(input) {
  const layout = [2, 3, 4].includes(Number(input?.layout)) ? Number(input.layout) : DEFAULT_STATE.layout;
  const sourceSlots = Array.isArray(input?.slots) ? input.slots : DEFAULT_STATE.slots;
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
    url: String(sourceSlots[index]?.url || "")
  }));

  return {
    layout,
    slots,
    sizes: normalizeSizes(input?.sizes)
  };
}

function normalizeSizes(input) {
  const sizes = structuredClone(DEFAULT_STATE.sizes);

  for (const layoutKey of Object.keys(sizes)) {
    for (const axis of Object.keys(sizes[layoutKey])) {
      const value = Number(input?.[layoutKey]?.[axis]);
      if (Number.isFinite(value)) {
        sizes[layoutKey][axis] = clamp(value, 18, 82);
      }
    }
  }

  return sizes;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
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
