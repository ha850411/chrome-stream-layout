"use strict";

function describeLiveError(error = {}) {
  const types = ["ErrorAuthorization", "ErrorNetwork", "ErrorNetworkIO", "ErrorTimeout",
    "ErrorNotAvailable", "ErrorNotSupported", "ErrorInvalidParameter", "ErrorInvalidState",
    "ErrorInvalidData", "ErrorNoSource", "Error"];
  const type = types.includes(error.type) ? error.type : "Error";
  const code = Number.isFinite(error.code) ? error.code : 0;
  const source = ["MasterPlaylist", "Playlist", "Segment", "Decoder"].includes(error.source) ? error.source : "Player";
  const kind = type === "ErrorAuthorization" || code === 401 || code === 403 ? "authorization" :
    ["ErrorNetwork", "ErrorNetworkIO", "ErrorTimeout", "ErrorNotAvailable"].includes(type) ? "network" : "media";
  return { kind, type, code, source,
    retryable: !["ErrorNotSupported", "ErrorInvalidParameter"].includes(type),
    retryAfterMs: code === 429 ? 30000 : 0 };
}

function createLiveEngine(video, callbacks) {
  if (!globalThis.IVSPlayer?.isPlayerSupported) throw new Error("IVS is unavailable");
  const player = IVSPlayer.create({
    wasmWorker: chrome.runtime.getURL("src/vendor/ivs/amazon-ivs-wasmworker.min.js"),
    wasmBinary: chrome.runtime.getURL("src/vendor/ivs/amazon-ivs-wasmworker.min.wasm")
  });
  let disposed = false;
  let qualities = [];
  let selected = "auto";
  let autoplay = true;
  let initial = true;
  let size = { width: 0, height: 0 };
  let appliedSize;
  let resizeTimer = 0;
  const listeners = [];
  const on = (event, callback) => {
    const guarded = (...args) => { if (!disposed) callback(...args); };
    listeners.push([event, guarded]);
    player.addEventListener(event, guarded);
  };
  const applySize = (force = false) => {
    window.clearTimeout(resizeTimer);
    resizeTimer = 0;
    if (disposed || !size.width || !size.height) return;
    if (!force && appliedSize?.width === size.width && appliedSize?.height === size.height) return;
    player.setAutoMaxVideoSize(size.width, size.height);
    appliedSize = size;
  };
  const resize = (width, height) => {
    if (disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    width = Math.ceil(width);
    height = Math.ceil(height);
    if (size.width === width && size.height === height) return;
    size = { width, height };
    // Each SDK call posts to its WASM worker. Keep the first cap immediate,
    // then send only the latest dimensions during a continuous splitter drag.
    if (!appliedSize) applySize();
    else if (!resizeTimer) resizeTimer = window.setTimeout(() => applySize(), 250);
  };
  const setQuality = (value) => {
    if (disposed) return;
    const option = qualities.find((q) => q.value === value);
    selected = option ? option.value : "auto";
    if (option) player.setQuality(option.quality, true);
    else player.setAutoQualityMode(true);
    return selected;
  };
  player.attachHTMLVideoElement(video);
  player.setLiveLowLatencyEnabled(true);
  player.setRebufferToLive(true);
  on(IVSPlayer.PlayerState.READY, () => {
    const unique = new Map();
    for (const quality of player.getQualities()) {
      if (!quality.height) continue;
      const value = `${quality.height}p${Math.round(quality.framerate) || ""}`;
      unique.set(value, { value, label: value, quality });
    }
    qualities = [...unique.values()].sort((a, b) => b.quality.height - a.quality.height || b.quality.framerate - a.quality.framerate);
    // A fresh stream must receive its cap even if the pane did not resize.
    applySize(true);
    setQuality(selected);
    callbacks.qualities(qualities, selected);
    // setAutoplay already starts playback; another play() sends duplicate work.
    if (!autoplay) callbacks.status("sourcePaused");
  });
  on(IVSPlayer.PlayerState.PLAYING, () => callbacks.status("sourcePlaying"));
  on(IVSPlayer.PlayerState.BUFFERING, () => callbacks.status("sourceBuffering"));
  on(IVSPlayer.PlayerState.ENDED, () => callbacks.error({ kind: "ended" }));
  on(IVSPlayer.PlayerEventType.ERROR, (error) => callbacks.error(describeLiveError(error)));
  // Browser autoplay rejection is recoverable with the custom Play button.
  on(IVSPlayer.PlayerEventType.PLAYBACK_BLOCKED, () => callbacks.status("sourcePaused"));
  return {
    player,
    setQuality,
    resize,
    load({ src, quality = "auto", muted = true, volume, autoplay: shouldPlay = true }) {
      if (disposed) return;
      qualities = [];
      selected = quality;
      autoplay = shouldPlay;
      if (initial) {
        player.setMuted(muted);
        if (Number.isFinite(volume)) player.setVolume(volume);
        initial = false;
      }
      player.setAutoplay(autoplay);
      player.load(src);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(resizeTimer);
      resizeTimer = 0;
      for (const [event, callback] of listeners) player.removeEventListener(event, callback);
      player.delete();
    }
  };
}
