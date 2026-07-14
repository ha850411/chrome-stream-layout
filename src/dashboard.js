"use strict";

const STORAGE_KEY = "chrome-stream-layout-state-v1";
const OPEN_CONTROLS_KEY = "chrome-stream-layout-open-controls-request-v1";
const OPEN_CONTROLS_MAX_AGE_MS = 10000;
const FRAME_VIEWPORT_NOTIFY_DELAY_MS = 100;
const PREVIOUS_STORAGE_KEY = "live-mosaic-state-v2";
const LEGACY_STORAGE_KEY = "live-mosaic-state-v1";
const SLOT_COUNT = 4;
const BILIBILI_ROOM_INIT_ENDPOINT = "https://api.live.bilibili.com/room/v1/Room/room_init";
const YESLIVE_THEATER_VIEWPORT = {
  width: 1920,
  height: 1080
};
const SUPPORTED_LANGUAGES = ["zh-TW", "en"];
const DEFAULT_STATE = {
  language: "en",
  layout: 4,
  sizes: {
    layout2: { col: 50 },
    layout3: { col: 66, row: 50 },
    layout4: { col: 50, row: 50 }
  },
  slots: Array.from({ length: SLOT_COUNT }, () => ({ url: "" }))
};

const TRANSLATIONS = {
  en: {
    reloadAll: "Reload all",
    layoutFullscreen: "Layout fullscreen",
    exitLayoutFullscreen: "Exit layout fullscreen",
    close: "Close",
    sourcesAndLayout: "Sources and layout",
    language: "Language",
    paneCount: "Pane count",
    pane: "Pane {number}",
    idle: "Idle",
    clear: "Clear",
    clearPane: "Clear pane {number}",
    apply: "Apply",
    applied: "Applied",
    cleared: "Cleared",
    layoutChanged: "Layout {number}",
    languageChanged: "Language changed",
    resized: "Resized",
    resetSplit: "Split reset",
    noSource: "No source set",
    cannotLoad: "Cannot load",
    enterCompleteUrl: "Enter a complete URL.",
    httpOnly: "Only http and https sources are supported.",
    video: "Video",
    dragWidth: "Drag to resize width",
    dragHeight: "Drag to resize height"
  },
  "zh-TW": {
    reloadAll: "全部重新載入",
    layoutFullscreen: "版面全螢幕",
    exitLayoutFullscreen: "離開版面全螢幕",
    close: "關閉",
    sourcesAndLayout: "來源與版面",
    language: "介面語言",
    paneCount: "窗格數量",
    pane: "窗格 {number}",
    idle: "未使用",
    clear: "清除",
    clearPane: "清除窗格 {number}",
    apply: "套用",
    applied: "已套用",
    cleared: "已清除",
    layoutChanged: "已切換為 {number} 個窗格",
    languageChanged: "已切換語言",
    resized: "已調整大小",
    resetSplit: "已重設分隔線",
    noSource: "尚未設定來源",
    cannotLoad: "無法載入",
    enterCompleteUrl: "請輸入完整網址。",
    httpOnly: "僅支援 http 與 https 來源。",
    video: "影片",
    dragWidth: "拖曳以調整寬度",
    dragHeight: "拖曳以調整高度"
  }
};

const ICONS = {
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  maximize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>',
  minimize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M16 21v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>'
};

let state = structuredClone(DEFAULT_STATE);
let saveTimer = 0;
let renderToken = 0;
let frameViewportNotifyTimer = 0;
let frameViewportNotifyDeadline = 0;
let frameViewportNotifyReason = "layout";
const bilibiliRoomIdCache = new Map();

const stage = document.querySelector("#stage");
const fullscreenTarget = document.body;
const controlOverlay = document.querySelector("#controlOverlay");
const streamForm = document.querySelector("#streamForm");
const slotControls = document.querySelector("#slotControls");
const saveStatus = document.querySelector("#saveStatus");
const clearButton = document.querySelector("#clearButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const reloadAllButton = document.querySelector("#reloadAllButton");
const closeControlsButton = document.querySelector("#closeControlsButton");
const applyButton = document.querySelector("#applyButton");
const controlsSubtitle = document.querySelector("#controlsSubtitle");
const languageLabel = document.querySelector("#languageLabel");
const languageButtons = Array.from(document.querySelectorAll("[data-language]"));
const layoutButtons = Array.from(document.querySelectorAll("[data-layout]"));
const fixedViewportObserver = new ResizeObserver(updateFixedViewportScales);

init();

async function init() {
  state = normalizeState(await readState());
  applyLanguage();
  renderControls();
  await ensureFrameHeaderRules();
  await renderStage();
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
    void renderStage();
    void persistState(t("applied"));
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
    void renderStage();
    void persistState(t("cleared"));
  });

  closeControlsButton.addEventListener("click", closeControls);

  controlOverlay.addEventListener("click", (event) => {
    if (event.target === controlOverlay) {
      closeControls();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!controlOverlay.hidden) {
        closeControls();
      }
    }
  });

  reloadAllButton.addEventListener("click", reloadAllTiles);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenState);
  window.addEventListener("resize", syncViewportState, { passive: true });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "chrome-stream-layout:youtube-embed-error") {
      fallbackFromYouTubeEmbed(event);
    }
  });

  layoutButtons.forEach((button) => {
    button.addEventListener("click", () => {
      syncStateFromForm();
      state.layout = Number(button.dataset.layout);
      renderControls();
      void renderStage();
      void persistState(t("layoutChanged", { number: state.layout }));
    });
  });

  languageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      syncStateFromForm();
      state.language = normalizeLanguage(button.dataset.language);
      applyLanguage();
      renderControls();
      void renderStage();
      void persistState(t("languageChanged"));
    });
  });

  stage.addEventListener("pointerdown", startResize);

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
    if (areaName === "local" && changes[OPEN_CONTROLS_KEY]?.newValue) {
      openControls();
    }
  });
}

async function ensureFrameHeaderRules() {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({ type: "ensure-frame-header-rules" });
  } catch {
    // Static rules still cover this path when the background worker is unavailable.
  }
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
    label.textContent = t("pane", { number: index + 1 });

    const status = document.createElement("span");
    status.textContent = disabled ? t("idle") : getSourceLabel(slot.url);

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
    clearSlotButton.title = t("clear");
    clearSlotButton.setAttribute("aria-label", t("clearPane", { number: index + 1 }));
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

  languageButtons.forEach((button) => {
    const active = button.dataset.language === state.language;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function renderStage() {
  const currentRenderToken = ++renderToken;
  const layout = state.layout;
  const slots = state.slots.slice(0, layout).map((slot) => ({ url: slot.url }));
  const embeds = await Promise.all(slots.map((slot) => slot.url.trim() ? resolveEmbed(slot.url) : null));

  if (currentRenderToken !== renderToken) {
    return;
  }

  stage.className = `stage layout-${layout}`;
  fixedViewportObserver.disconnect();
  stage.replaceChildren();

  for (let index = 0; index < layout; index += 1) {
    const slot = slots[index];
    const tile = document.createElement("article");
    tile.className = `tile tile-${index + 1}`;
    tile.dataset.tile = String(index);

    if (!slot.url.trim()) {
      tile.append(createEmptyState(index));
      stage.append(tile);
      continue;
    }

    const embed = embeds[index];

    if (!embed.ok) {
      tile.append(createErrorState(embed.message));
      stage.append(tile);
      continue;
    }

    tile.append(createTileFrame(index, embed));
    stage.append(tile);
  }

  appendSplitters();
  applyStageSizing();
  observeFixedViewportShells();
}

function createTileFrame(index, embed) {
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
  iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write; web-share";
  iframe.allowFullscreen = true;
  iframe.loading = "eager";
  iframe.referrerPolicy = embed.referrerPolicy || "strict-origin-when-cross-origin";
  iframe.setAttribute("allowfullscreen", "true");

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

function fallbackFromYouTubeEmbed(event) {
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
  iframe.src = fallbackSrc;
}

function createEmptyState(index) {
  const empty = document.createElement("div");
  empty.className = "tile-empty";
  empty.innerHTML = `<span><strong>${escapeHtml(t("pane", { number: index + 1 }))}</strong>${escapeHtml(t("noSource"))}</span>`;
  return empty;
}

function createErrorState(message) {
  const error = document.createElement("div");
  error.className = "tile-error";
  error.innerHTML = `<span><strong>${escapeHtml(t("cannotLoad"))}</strong>${escapeHtml(message)}</span>`;
  return error;
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
  document.body.tabIndex = -1;
  document.body.focus({ preventScroll: true });
}

function reloadAllTiles() {
  Array.from(stage.querySelectorAll("iframe[data-tile-frame]")).forEach((iframe) => {
    iframe.src = iframe.src;
  });
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
  fullscreenButton.innerHTML = isFullscreen ? ICONS.minimize : ICONS.maximize;

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
  splitter.title = axis === "col" ? t("dragWidth") : t("dragHeight");
  splitter.setAttribute("aria-label", splitter.title);
  splitter.setAttribute("aria-orientation", axis === "col" ? "vertical" : "horizontal");
  return splitter;
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

async function resolveEmbed(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) {
    return { ok: false, message: t("enterCompleteUrl") };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, message: t("httpOnly") };
  }

  const youtubeEmbed = getYouTubeEmbedUrl(parsed);
  if (youtubeEmbed) {
    return {
      ok: true,
      src: youtubeEmbed,
      fallbackSrc: parsed.href,
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  const bilibiliLivePlayer = await getBilibiliLivePlayerUrl(parsed);
  if (bilibiliLivePlayer) {
    return {
      ok: true,
      src: bilibiliLivePlayer,
      referrerPolicy: "no-referrer-when-downgrade"
    };
  }

  if (isYesLiveHost(parsed.hostname.toLowerCase())) {
    return {
      ok: true,
      src: parsed.href,
      fixedViewport: YESLIVE_THEATER_VIEWPORT,
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  return {
    ok: true,
    src: parsed.href,
    referrerPolicy: "strict-origin-when-cross-origin"
  };
}

function getYouTubeEmbedUrl(url) {
  const hostname = url.hostname.toLowerCase();
  if (!isYouTubeHost(hostname)) {
    return "";
  }

  const videoId = getYouTubeVideoId(url);
  const playlistId = url.searchParams.get("list") || (url.pathname === "/playlist" ? url.searchParams.get("list") : "");
  if (!videoId && !playlistId) {
    return "";
  }

  const embedUrl = new URL(
    videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : "https://www.youtube.com/embed/videoseries"
  );
  embedUrl.searchParams.set("autoplay", "1");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("rel", "0");
  embedUrl.searchParams.set("origin", location.origin);
  embedUrl.searchParams.set("widget_referrer", location.href);

  if (playlistId) {
    embedUrl.searchParams.set("list", playlistId);
  }

  copyYouTubeParam(url, embedUrl, "index");
  copyYouTubeParam(url, embedUrl, "loop");
  copyYouTubeParam(url, embedUrl, "si");

  const startSeconds = getYouTubeStartSeconds(url);
  if (startSeconds > 0) {
    embedUrl.searchParams.set("start", String(startSeconds));
  }

  return embedUrl.href;
}

function getYouTubeVideoId(url) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be") {
    return sanitizeYouTubeId(url.pathname.split("/").filter(Boolean)[0]);
  }

  const queryVideoId = sanitizeYouTubeId(url.searchParams.get("v"));
  if (queryVideoId) {
    return queryVideoId;
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (["embed", "live", "shorts", "v"].includes(pathParts[0])) {
    return sanitizeYouTubeId(pathParts[1]);
  }

  return "";
}

function sanitizeYouTubeId(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(normalized) ? normalized : "";
}

function copyYouTubeParam(source, destination, name) {
  const value = source.searchParams.get(name);
  if (value) {
    destination.searchParams.set(name, value);
  }
}

function getYouTubeStartSeconds(url) {
  const value = url.searchParams.get("start") || url.searchParams.get("t") || "";
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match || !match[0]) {
    return 0;
  }

  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function getSourceLabel(rawUrl) {
  if (!rawUrl.trim()) return "";

  const parsed = parseUrl(rawUrl);
  if (!parsed) return "URL";

  const hostname = parsed.hostname.toLowerCase();
  if (isYouTubeHost(hostname)) return "YouTube";
  if (isTwitchHost(hostname)) return "Twitch";
  if (isBilibiliHost(hostname)) return "Bilibili";
  if (isYesLiveHost(hostname)) return "YesLive";
  if (isHuyaHost(hostname)) return "Huya";
  if (isDirectMediaUrl(parsed)) return getMediaLabel(parsed);
  return hostname || "URL";
}

function getMediaLabel(url) {
  const extension = getPathExtension(url);
  return extension ? `${t("video")} .${extension}` : t("video");
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

async function getBilibiliLivePlayerUrl(url) {
  if (!isBilibiliHost(url.hostname.toLowerCase())) {
    return "";
  }

  const roomId = getBilibiliLiveRoomId(url);
  if (!roomId) {
    return "";
  }

  const resolvedRoomId = await resolveBilibiliLiveRoomId(roomId);
  if (!resolvedRoomId) {
    return "";
  }

  const playerUrl = new URL("https://www.bilibili.com/blackboard/live/live-activity-player.html");
  playerUrl.searchParams.set("cid", resolvedRoomId);
  playerUrl.searchParams.set("mute", "1");
  playerUrl.searchParams.set("danmaku", "0");
  playerUrl.searchParams.set("fullscreen", "1");
  playerUrl.searchParams.set("quality", "1");
  playerUrl.searchParams.set("sendpanel", "0");
  playerUrl.searchParams.set("recommend", "0");
  playerUrl.searchParams.set("logo", "0");
  playerUrl.searchParams.set("enableAutoPlayTips", "0");
  return playerUrl.href;
}

async function resolveBilibiliLiveRoomId(roomId) {
  if (!isNumericId(roomId)) {
    return "";
  }

  if (bilibiliRoomIdCache.has(roomId)) {
    return bilibiliRoomIdCache.get(roomId);
  }

  const request = fetchBilibiliLiveRoomId(roomId);
  bilibiliRoomIdCache.set(roomId, request);

  const resolvedRoomId = await request;
  bilibiliRoomIdCache.set(roomId, resolvedRoomId);
  return resolvedRoomId;
}

async function fetchBilibiliLiveRoomId(roomId) {
  try {
    const apiUrl = new URL(BILIBILI_ROOM_INIT_ENDPOINT);
    apiUrl.searchParams.set("id", roomId);

    const response = await fetch(apiUrl.href, {
      credentials: "omit",
      cache: "no-store"
    });
    if (!response.ok) {
      return roomId;
    }

    const payload = await response.json();
    const resolvedRoomId = payload?.data?.room_id;
    return isNumericId(resolvedRoomId) ? String(resolvedRoomId) : roomId;
  } catch {
    return roomId;
  }
}

function getBilibiliLiveRoomId(url) {
  const fromQuery = url.searchParams.get("roomId") || url.searchParams.get("room_id") || url.searchParams.get("cid");
  if (isNumericId(fromQuery)) {
    return fromQuery;
  }

  if (url.hostname.toLowerCase() !== "live.bilibili.com") {
    return "";
  }

  const [firstPathPart] = url.pathname.split("/").filter(Boolean);
  return isNumericId(firstPathPart) ? firstPathPart : "";
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
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

function isYesLiveHost(hostname) {
  return hostname === "yes2049.com" || hostname.endsWith(".yes2049.com") || hostname === "yeslivetv.com" || hostname.endsWith(".yeslivetv.com") || hostname === "welife6.com" || hostname.endsWith(".welife6.com");
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
  const language = normalizeLanguage(input?.language);
  const layout = [2, 3, 4].includes(Number(input?.layout)) ? Number(input.layout) : DEFAULT_STATE.layout;
  const sourceSlots = Array.isArray(input?.slots) ? input.slots : DEFAULT_STATE.slots;
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
    url: String(sourceSlots[index]?.url || "")
  }));

  return {
    language,
    layout,
    slots,
    sizes: normalizeSizes(input?.sizes)
  };
}

function normalizeLanguage(language) {
  if (SUPPORTED_LANGUAGES.includes(language)) {
    return language;
  }

  return navigator.language?.toLowerCase().startsWith("zh") ? "zh-TW" : DEFAULT_STATE.language;
}

function t(key, replacements = {}) {
  const dictionary = TRANSLATIONS[state.language] || TRANSLATIONS.en;
  const template = dictionary[key] || TRANSLATIONS.en[key] || key;
  return Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template
  );
}

function applyLanguage() {
  document.documentElement.lang = state.language === "zh-TW" ? "zh-Hant" : "en";
  controlsSubtitle.textContent = t("sourcesAndLayout");
  languageLabel.textContent = t("language");
  clearButton.textContent = t("clear");
  applyButton.textContent = t("apply");
  reloadAllButton.title = t("reloadAll");
  reloadAllButton.setAttribute("aria-label", t("reloadAll"));
  closeControlsButton.title = t("close");
  closeControlsButton.setAttribute("aria-label", t("close"));
  document.querySelector(".layout-switch").setAttribute("aria-label", t("paneCount"));
  syncFullscreenState();
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
