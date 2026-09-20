"use strict";

const surface = document.querySelector("#player");
const video = document.querySelector("#video");
const toolbar = document.querySelector("#controls");
const platform = document.querySelector("#platform");
const message = document.querySelector("#message");
const playButton = document.querySelector("#play");
const muteButton = document.querySelector("#mute");
const volume = document.querySelector("#volume");
const liveButton = document.querySelector("#live");
const quality = document.querySelector("#quality");
const fullscreenButton = document.querySelector("#fullscreen");
const events = new AbortController();
let callbacks = {};
let engine;
let failed = false;
let disposed = false;
let loading = true;
let started = false;
let intendedPlayback = false;
let savedPreferences;
let lastError;
let playbackStatus = "sourceLoading";
let context = {};
let labels;
let idleTimer = 0;
let idleDeadline = 0;
const translations = {
  en: { play: "Play live", pause: "Pause", mute: "Mute", unmute: "Unmute", volume: "Volume", fullscreen: "Fullscreen", exit: "Exit fullscreen", controls: "Playback controls" },
  "zh-TW": { play: "播放直播", pause: "暫停", mute: "靜音", unmute: "取消靜音", volume: "音量", fullscreen: "全螢幕", exit: "結束全螢幕", controls: "播放控制" }
};
const toolbarHasFocus = () => toolbar.contains(document.activeElement) && document.activeElement.matches(":focus-visible");
const on = (target, type, callback) => target.addEventListener(type, callback, { signal: events.signal });
const label = (element, value) => { element.title = value; element.setAttribute("aria-label", value); };

function hideControls() {
  window.clearTimeout(idleTimer);
  idleTimer = 0;
  surface.classList.remove("player-controls-visible");
}
function checkIdle() {
  idleTimer = 0;
  const remaining = idleDeadline - performance.now();
  if (remaining > 0) idleTimer = window.setTimeout(checkIdle, remaining);
  else if (!toolbar.matches(":hover") && !toolbarHasFocus()) hideControls();
}
function showControls() {
  // Pointer movement only extends the deadline once the controls are visible.
  if (!surface.classList.contains("player-controls-visible")) surface.classList.add("player-controls-visible");
  idleDeadline = performance.now() + 2200;
  if (!idleTimer) idleTimer = window.setTimeout(checkIdle, 2200);
}
function syncControls() {
  if (!labels) return;
  const paused = video.paused || playbackStatus === "sourcePaused";
  label(playButton, paused ? labels.play : labels.pause);
  document.querySelector("#playIcon").setAttribute("d", paused ? "m8 5 11 7-11 7Z" : "M8 5v14M16 5v14");
  const muted = video.muted || video.volume === 0;
  label(muteButton, muted ? labels.unmute : labels.mute);
  muteButton.setAttribute("aria-pressed", String(muted));
  document.querySelector("#soundIcon").setAttribute("d", muted ? "m17 9 5 6m0-6-5 6" : "M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14");
  volume.value = String(video.volume);
  label(fullscreenButton, document.fullscreenElement ? labels.exit : labels.fullscreen);
  liveButton.classList.toggle("is-live", playbackStatus === "sourcePlaying");
  liveButton.disabled = loading;
  playButton.disabled = !engine || loading || failed;
  muteButton.disabled = !engine || failed;
  volume.disabled = !engine || failed;
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
function showError(text) {
  if (engine) savedPreferences = { muted: video.muted, volume: video.volume };
  failed = true;
  playbackStatus = "sourceMediaError";
  loading = false;
  engine?.destroy();
  engine = null;
  message.textContent = text;
  quality.disabled = true;
  syncControls();
  showControls();
}
function goLive() {
  if (!loading && !disposed) callbacks.live?.();
}
function togglePlay() {
  if (!engine || failed || loading) return;
  if (video.paused) goLive();
  else { intendedPlayback = false; engine.player.pause(); status("sourcePaused"); showControls(); }
}
function toggleMute() {
  if (!engine || failed) return;
  const unmute = video.muted || video.volume === 0;
  if (video.volume === 0) engine.player.setVolume(1);
  engine.player.setMuted(!unmute);
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await surface.requestFullscreen();
  } catch { /* Controls remain usable if the browser declines fullscreen. */ }
}
for (const type of ["pointerenter", "pointermove", "pointerdown", "focusin"]) on(surface, type, showControls);
on(surface, "pointerleave", () => { if (!toolbarHasFocus()) hideControls(); });
on(surface, "focusout", (event) => { if (!surface.contains(event.relatedTarget)) hideControls(); else showControls(); });
on(playButton, "click", togglePlay);
on(video, "click", togglePlay);
on(muteButton, "click", toggleMute);
on(volume, "input", () => {
  if (!engine) return;
  engine.player.setVolume(Number(volume.value));
  engine.player.setMuted(Number(volume.value) === 0);
});
on(liveButton, "click", goLive);
on(quality, "change", () => {
  const value = engine?.setQuality(quality.value);
  if (value) callbacks.quality?.(value);
});
on(fullscreenButton, "click", toggleFullscreen);
on(document, "fullscreenchange", syncControls);
on(video, "volumechange", syncControls);
on(video, "pause", () => { if (started && !loading && !intendedPlayback) status("sourcePaused"); });
on(surface, "keydown", (event) => {
  if (event.target.closest("button, input, select") || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === "Space" || event.key.toLowerCase() === "k") { event.preventDefault(); togglePlay(); }
  else if (event.key.toLowerCase() === "m") toggleMute();
  else if (event.key.toLowerCase() === "f") void toggleFullscreen();
  else if (event.key.toLowerCase() === "l") goLive();
});
const resize = new ResizeObserver(([entry]) => {
  if (entry) engine?.resize(entry.contentRect.width, entry.contentRect.height);
});
resize.observe(surface);

window.livePlayer = {
  get failed() { return failed; },
  get lastError() { return lastError; },
  getPreferences() { return engine ? { muted: video.muted, volume: video.volume } : savedPreferences; },
  setPreferences(value) { savedPreferences = { muted: value.muted, volume: value.volume }; video.muted = value.muted; video.volume = value.volume; },
  getHealth() {
    const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
    return { active: intendedPlayback, time: video.currentTime, frames: frames > 0 ? frames : null,
      buffering: playbackStatus !== "sourcePlaying" };
  },
  showNotice(text) { message.textContent = text; showControls(); },
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
    label(quality, value.quality);
    label(volume, labels.volume);
    quality.querySelector('[value="auto"]').textContent = value.auto;
    syncControls();
  },
  showLoading(text) {
    loading = true;
    if (!started) message.textContent = text;
    syncControls();
  },
  showError,
  load(config) {
    if (disposed) return;
    loading = false;
    failed = false;
    started = false;
    intendedPlayback = config.autoplay !== false;
    lastError = undefined;
    quality.disabled = true;
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
          quality.replaceChildren(new Option(context.auto, "auto"), ...options.map((q) => new Option(q.label, q.value)));
          quality.value = selected;
          quality.disabled = !options.length;
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
