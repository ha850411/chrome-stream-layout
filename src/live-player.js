"use strict";

const surface = document.querySelector("#player");
const video = document.querySelector("#video");
const toolbar = document.querySelector("#controls");
const platform = document.querySelector("#platform");
const message = document.querySelector("#message");
const playButton = document.querySelector("#play");
const centerPlayButton = document.querySelector("#centerPlay");
const muteButton = document.querySelector("#mute");
const volume = document.querySelector("#volume");
const volumeValue = document.querySelector("#volumeValue");
const liveButton = document.querySelector("#live");
const quality = document.querySelector("#quality");
const qualityValue = document.querySelector("#qualityValue");
const qualityMenu = document.querySelector("#qualityMenu");
const fullscreenButton = document.querySelector("#fullscreen");
const moreButton = document.querySelector("#more");
const playerOptions = document.querySelector("#playerOptions");
const errorActions = document.querySelector("#errorActions");
const CONTROLS_IDLE_DELAY_MS = 1000;
const compactControls = window.matchMedia("(max-width: 380px)");
let optionsOpen = false;
let qualityMenuOpen = false;
let qualityOptions = [];
const events = new AbortController();
let callbacks = {};
let engine;
let failed = false;
let disposed = false;
let loading = true;
let started = false;
let intendedPlayback = false;
let savedPreferences;
let synchronizedQuality = null;
let lastError;
let playbackStatus = "sourceLoading";
let context = {};
let labels;
let idleTimer = 0;
let idleDeadline = 0;
const translations = {
  en: { play: "Play live", pause: "Pause", mute: "Mute", unmute: "Unmute", volume: "Volume", fullscreen: "Fullscreen", exit: "Exit fullscreen", controls: "Playback controls", more: "More playback settings", quality: "Quality", edit: "Edit source", retry: "Retry", original: "Open original" },
  "zh-TW": { play: "播放直播", pause: "暫停", mute: "靜音", unmute: "取消靜音", volume: "音量", fullscreen: "全螢幕", exit: "結束全螢幕", controls: "播放控制", more: "更多播放設定", quality: "畫質", edit: "編輯來源", retry: "重試", original: "原站開啟" }
};
const controlsHaveFocus = () => (toolbar.contains(document.activeElement) || qualityMenu.contains(document.activeElement) || centerPlayButton === document.activeElement) && document.activeElement.matches(":focus-visible");
const on = (target, type, callback) => target.addEventListener(type, callback, { signal: events.signal });
const label = (element, value) => { element.title = value; element.setAttribute("aria-label", value); };

function hideControls() {
  window.clearTimeout(idleTimer);
  idleTimer = 0;
  if (surface.classList.contains("player-controls-visible")) {
    surface.classList.remove("player-controls-visible");
    callbacks.controlsVisible?.(false);
  }
}
function setPlayerOptions(open, returnFocus = false) {
  if (!open) setQualityMenu(false);
  optionsOpen = compactControls.matches && open;
  surface.classList.toggle("player-options-open", optionsOpen);
  moreButton.setAttribute("aria-expanded", String(optionsOpen));
  if (returnFocus) moreButton.focus();
  showControls();
}
function positionQualityMenu() {
  if (!qualityMenuOpen) return;
  const bounds = surface.getBoundingClientRect();
  const trigger = quality.getBoundingClientRect();
  const gap = 8;
  qualityMenu.style.maxHeight = `${Math.max(0, bounds.height - gap * 2)}px`;
  const width = qualityMenu.offsetWidth;
  const height = qualityMenu.offsetHeight;
  const left = Math.max(gap, Math.min(trigger.right - bounds.left - width, bounds.width - width - gap));
  const top = Math.max(gap, Math.min(trigger.top - bounds.top - height - 6, bounds.height - height - gap));
  qualityMenu.style.left = `${left}px`;
  qualityMenu.style.top = `${top}px`;
}
function setQualityMenu(open, returnFocus = false) {
  const wasOpen = qualityMenuOpen;
  qualityMenuOpen = open && !quality.disabled;
  quality.setAttribute("aria-expanded", String(qualityMenuOpen));
  surface.classList.toggle("quality-menu-open", qualityMenuOpen);
  if (!qualityMenuOpen && wasOpen && qualityMenu.contains(document.activeElement)) {
    (returnFocus && !quality.disabled ? quality : surface).focus({ preventScroll: true });
  }
  qualityMenu.hidden = !qualityMenuOpen;
  if (qualityMenuOpen) {
    positionQualityMenu();
    const selected = qualityMenu.querySelector('[aria-checked="true"]') || qualityMenu.firstElementChild;
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
  } else if (wasOpen && returnFocus && !quality.disabled) quality.focus({ preventScroll: true });
  if (wasOpen || qualityMenuOpen) showControls();
}
function syncQuality() {
  const selected = qualityOptions.find(option => option.value === quality.value);
  qualityValue.textContent = selected?.label || context.auto || "Auto";
  label(quality, `${context.quality || labels?.quality || "Quality"}: ${qualityValue.textContent}`);
  for (const option of qualityMenu.children) option.setAttribute("aria-checked", String(option.value === quality.value));
  if (quality.disabled) setQualityMenu(false);
}
function renderQualityMenu() {
  setQualityMenu(false, true);
  qualityMenu.replaceChildren(...qualityOptions.map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.value = option.value;
    button.tabIndex = -1;
    button.setAttribute("role", "menuitemradio");
    button.innerHTML = '<span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
    button.firstElementChild.textContent = option.label;
    return button;
  }));
  syncQuality();
}
function checkIdle() {
  idleTimer = 0;
  const remaining = idleDeadline - performance.now();
  if (remaining > 0) idleTimer = window.setTimeout(checkIdle, remaining);
  else if (!optionsOpen && !qualityMenuOpen && !toolbar.matches(":hover") && !centerPlayButton.matches(":hover") && !controlsHaveFocus()) hideControls();
}
function showControls() {
  // Pointer movement only extends the deadline once the controls are visible.
  if (!surface.classList.contains("player-controls-visible")) {
    surface.classList.add("player-controls-visible");
    callbacks.controlsVisible?.(true);
  }
  idleDeadline = performance.now() + CONTROLS_IDLE_DELAY_MS;
  if (!idleTimer) idleTimer = window.setTimeout(checkIdle, CONTROLS_IDLE_DELAY_MS);
}
function syncControls() {
  if (!labels) return;
  const paused = video.paused || playbackStatus === "sourcePaused";
  label(playButton, paused ? labels.play : labels.pause);
  label(centerPlayButton, paused ? labels.play : labels.pause);
  document.querySelector("#playIcon").setAttribute("d", paused ? "m8 5 11 7-11 7Z" : "M8 5v14M16 5v14");
  centerPlayButton.dataset.state = paused ? "paused" : "playing";
  const muted = video.muted || video.volume === 0;
  label(muteButton, muted ? labels.unmute : labels.mute);
  muteButton.setAttribute("aria-pressed", String(muted));
  const soundIcon = document.querySelector("#soundIcon");
  if (soundIcon) {
    if (muted) {
      soundIcon.setAttribute("d", "m17 9 5 6m0-6-5 6");
    } else if (video.volume < 0.5) {
      soundIcon.setAttribute("d", "M17 9a4 4 0 0 1 0 6");
    } else {
      soundIcon.setAttribute("d", "M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14");
    }
  }
  surface.classList.toggle("has-audio", !muted && playbackStatus === "sourcePlaying");
  const volumePercent = `${Math.round(video.volume * 100)}%`;
  volume.value = String(video.volume);
  volume.style.setProperty("--volume-fill", volumePercent);
  volume.setAttribute("aria-valuetext", volumePercent);
  volumeValue.textContent = volumePercent;
  label(fullscreenButton, document.fullscreenElement ? labels.exit : labels.fullscreen);
  document.querySelector("#fullscreenLabel").textContent = document.fullscreenElement ? labels.exit : labels.fullscreen;
  liveButton.classList.toggle("is-live", playbackStatus === "sourcePlaying");
  liveButton.disabled = loading;
  playButton.disabled = !engine || loading || failed;
  centerPlayButton.disabled = playButton.disabled;
  centerPlayButton.hidden = playButton.disabled;
  muteButton.disabled = !engine || failed;
  volume.disabled = !engine || failed;
  document.querySelector("#retrySource").disabled = loading;
  syncQuality();
}
function status(value) {
  if (disposed || failed) return;
  if (value === "sourcePaused") intendedPlayback = false;
  playbackStatus = value;
  if (value === "sourcePlaying") started = true;
  if (value === "sourcePaused") showControls();
  message.textContent = value === "sourceBuffering" || value === "sourceLoading" ? context.loading || "" : "";
  callbacks.status?.(value);
  syncControls();
}
function showError(text, tone = "error") {
  if (engine) savedPreferences = { muted: video.muted, volume: video.volume };
  failed = true;
  playbackStatus = "sourceMediaError";
  loading = false;
  engine?.destroy();
  engine = null;
  message.textContent = text;
  message.dataset.tone = tone;
  errorActions.hidden = false;
  quality.disabled = true;
  syncControls();
  showControls();
}
function goLive() {
  if (!loading && !disposed) callbacks.live?.();
}
function togglePlay() {
  if (centerPlayButton) {
    centerPlayButton.classList.remove("is-rippling");
    void centerPlayButton.offsetWidth;
    centerPlayButton.classList.add("is-rippling");
  }
  if (!engine || failed || loading) return;
  if (video.paused) goLive();
  else { intendedPlayback = false; engine.player.pause(); status("sourcePaused"); showControls(); }
}
function toggleMute() {
  if (!engine || failed) return;
  const unmute = video.muted || video.volume === 0;
  const nextVolume = video.volume === 0 ? 1 : video.volume;
  if (video.volume === 0) engine.player.setVolume(1);
  engine.player.setMuted(!unmute);
  callbacks.preferences?.({ muted: !unmute, volume: nextVolume }, true);
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await surface.requestFullscreen();
  } catch { /* Controls remain usable if the browser declines fullscreen. */ }
}
for (const type of ["pointerenter", "pointermove", "pointerdown", "focusin", "keydown"]) {
  on(surface, type, () => {
    showControls();
    callbacks.activity?.();
  });
}
on(surface, "pointerleave", () => { if (!optionsOpen && !qualityMenuOpen && !controlsHaveFocus()) hideControls(); });
on(surface, "focusout", (event) => {
  if (!surface.contains(event.relatedTarget)) { setPlayerOptions(false); hideControls(); }
  else {
    if (qualityMenuOpen && !qualityMenu.contains(event.relatedTarget) && event.relatedTarget !== quality) setQualityMenu(false);
    showControls();
  }
});
on(playButton, "click", togglePlay);
on(centerPlayButton, "click", togglePlay);
on(moreButton, "click", () => setPlayerOptions(!optionsOpen));
on(playerOptions, "scroll", positionQualityMenu);
on(compactControls, "change", () => {
  const hadQualityFocus = qualityMenu.contains(document.activeElement);
  setQualityMenu(false, hadQualityFocus);
  setPlayerOptions(compactControls.matches && playerOptions.contains(document.activeElement));
});
on(surface, "click", (event) => {
  if (qualityMenuOpen && !qualityMenu.contains(event.target) && !quality.contains(event.target)) setQualityMenu(false);
  if (optionsOpen && !playerOptions.contains(event.target) && !moreButton.contains(event.target) && !qualityMenu.contains(event.target)) setPlayerOptions(false);
});
on(document.querySelector("#retrySource"), "click", goLive);
on(document.querySelector("#editSource"), "click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  callbacks.edit?.();
});
on(muteButton, "click", toggleMute);
on(volume, "input", () => {
  if (!engine) return;
  engine.player.setVolume(Number(volume.value));
  engine.player.setMuted(Number(volume.value) === 0);
  callbacks.preferences?.({ muted: Number(volume.value) === 0, volume: Number(volume.value) });
});
on(volume, "change", () => {
  if (engine) callbacks.preferences?.({ muted: Number(volume.value) === 0, volume: Number(volume.value) }, true);
});
on(liveButton, "click", goLive);
on(quality, "click", () => setQualityMenu(!qualityMenuOpen));
on(quality, "keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  setQualityMenu(true);
  (event.key === "ArrowUp" ? qualityMenu.lastElementChild : qualityMenu.firstElementChild)?.focus();
});
on(qualityMenu, "click", (event) => {
  const option = event.target.closest('[role="menuitemradio"]');
  if (!option || quality.disabled) return;
  const value = engine?.setQuality(option.value);
  if (value) {
    quality.value = value;
    syncQuality();
    callbacks.quality?.(value);
  }
  setQualityMenu(false, true);
});
on(qualityMenu, "keydown", (event) => {
  if (event.key === "Tab") { setQualityMenu(false, true); return; }
  const options = [...qualityMenu.children];
  const index = options.indexOf(document.activeElement);
  let next;
  if (event.key === "ArrowDown") next = options[(index + 1) % options.length];
  else if (event.key === "ArrowUp") next = options[(index - 1 + options.length) % options.length];
  else if (event.key === "Home") next = options[0];
  else if (event.key === "End") next = options.at(-1);
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    next = [...options.slice(index + 1), ...options.slice(0, index + 1)]
      .find(option => option.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
  }
  if (next) { event.preventDefault(); next.focus(); }
});
on(fullscreenButton, "click", toggleFullscreen);
on(video, "dblclick", (event) => { event.preventDefault(); toggleFullscreen(); });
on(document, "fullscreenchange", syncControls);
on(video, "volumechange", syncControls);
on(video, "pause", () => { if (started && !loading && !intendedPlayback) status("sourcePaused"); });
on(surface, "keydown", (event) => {
  if (event.key === "Escape" && qualityMenuOpen) {
    event.preventDefault();
    event.stopPropagation();
    setQualityMenu(false, true);
    return;
  }
  if (event.key === "Escape" && optionsOpen) {
    event.preventDefault();
    event.stopPropagation();
    setPlayerOptions(false, true);
    return;
  }
  if (event.target.closest("button, input, select") || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === "Space" || event.key.toLowerCase() === "k") { event.preventDefault(); togglePlay(); }
  else if (event.key.toLowerCase() === "m") toggleMute();
  else if (event.key.toLowerCase() === "f") void toggleFullscreen();
  else if (event.key.toLowerCase() === "l") goLive();
});
const resize = new ResizeObserver(([entry]) => {
  if (entry) engine?.resize(entry.contentRect.width, entry.contentRect.height);
  positionQualityMenu();
});
resize.observe(surface);

window.livePlayer = {
  get failed() { return failed; },
  get lastError() { return lastError; },
  getPreferences() { return engine ? { muted: video.muted, volume: video.volume } : savedPreferences; },
  setPreferences(value) { savedPreferences = { muted: value.muted, volume: value.volume }; video.muted = value.muted; video.volume = value.volume; },
  applyPreferences(value) {
    if (typeof value.muted === "boolean" && video.muted !== value.muted) {
      if (engine) engine.player.setMuted(value.muted);
      else video.muted = value.muted;
    }
    if (Number.isFinite(value.volume) && video.volume !== value.volume) {
      if (engine) engine.player.setVolume(value.volume);
      else video.volume = value.volume;
    }
    if (engine && value.quality && quality.value !== value.quality) {
      if (quality.disabled) synchronizedQuality = value.quality;
      else quality.value = engine.setQuality(value.quality) || "auto";
    }
    savedPreferences = { muted: video.muted, volume: video.volume };
    syncControls();
  },
  getHealth() {
    const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
    return { active: intendedPlayback, time: video.currentTime, frames: frames > 0 ? frames : null,
      buffering: playbackStatus !== "sourcePlaying" };
  },
  showNotice(text, tone = "loading") { message.textContent = text; message.dataset.tone = tone; showControls(); },
  bind(value) { callbacks = value; },
  setContext(value) {
    context = value;
    labels = translations[value.language] || translations.en;
    document.documentElement.lang = value.language === "zh-TW" ? "zh-Hant" : "en";
    surface.setAttribute("aria-label", value.pane);
    toolbar.setAttribute("aria-label", labels.controls);
    platform.textContent = { twitch: "Twitch", kick: "Kick" }[value.platform] || "";
    platform.dataset.platform = value.platform || "";
    label(liveButton, value.liveTitle);
    volume.setAttribute("aria-label", labels.volume);
    label(moreButton, labels.more);
    playerOptions.setAttribute("aria-label", labels.more);
    document.querySelector("#volumeLabel").textContent = labels.volume;
    document.querySelector("#qualityLabel").textContent = labels.quality;
    document.querySelector("#retrySource").textContent = labels.retry;
    document.querySelector("#editSource").textContent = labels.edit;
    const original = document.querySelector("#openSource");
    original.textContent = labels.original;
    try {
      const url = new URL(value.sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid source");
      original.href = url.href;
      original.hidden = false;
    } catch { original.removeAttribute("href"); original.hidden = true; }
    qualityOptions = [{ value: "auto", label: value.auto }, ...qualityOptions.filter(option => option.value !== "auto")];
    renderQualityMenu();
    syncControls();
  },
  showLoading(text) {
    loading = true;
    errorActions.hidden = true;
    message.dataset.tone = "loading";
    if (!started) message.textContent = text;
    syncControls();
  },
  showError,
  load(config) {
    if (disposed) return;
    loading = false;
    failed = false;
    errorActions.hidden = true;
    message.dataset.tone = "loading";
    started = false;
    intendedPlayback = config.autoplay !== false;
    lastError = undefined;
    quality.disabled = true;
    synchronizedQuality = null;
    status("sourceLoading");
    try {
      engine ||= createLiveEngine(video, {
        status,
        error: (error) => {
          lastError = error;
          showError(context.error);
          callbacks.failure?.(error);
        },
        qualities: (options, selected) => {
          qualityOptions = [{ value: "auto", label: context.auto }, ...options];
          quality.value = synchronizedQuality ? engine.setQuality(synchronizedQuality) || "auto" : selected;
          synchronizedQuality = null;
          quality.disabled = !options.length;
          renderQualityMenu();
        }
      });
      engine.resize(surface.clientWidth, surface.clientHeight);
      engine.load(config);
      syncControls();
    } catch {
      lastError = { kind: "setup", retryable: false };
      showError(context.error);
      callbacks.failure?.(lastError);
    }
  },
  destroy() {
    if (disposed) return;
    disposed = true;
    callbacks = {};
    hideControls();
    events.abort();
    resize.disconnect();
    engine?.destroy();
    engine = null;
    video.pause();
    video.removeAttribute("src");
    video.srcObject = null;
    video.load();
  }
};
on(window, "pagehide", () => window.livePlayer.destroy());
