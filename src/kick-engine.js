"use strict";

function createKickEngine(video, callbacks) {
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
  const listeners = [];
  const on = (event, callback) => {
    const guarded = (...args) => { if (!disposed) callback(...args); };
    listeners.push([event, guarded]);
    player.addEventListener(event, guarded);
  };
  const resize = (width, height) => {
    size = { width, height };
    if (!disposed && width > 0 && height > 0) player.setAutoMaxVideoSize(Math.ceil(width), Math.ceil(height));
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
    resize(size.width, size.height);
    setQuality(selected);
    callbacks.qualities(qualities, selected);
    if (autoplay) player.play();
    else callbacks.status("sourcePaused");
  });
  on(IVSPlayer.PlayerState.PLAYING, () => callbacks.status("sourcePlaying"));
  on(IVSPlayer.PlayerState.BUFFERING, () => callbacks.status("sourceBuffering"));
  on(IVSPlayer.PlayerState.ENDED, () => callbacks.error());
  on(IVSPlayer.PlayerEventType.ERROR, () => callbacks.error());
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
      for (const [event, callback] of listeners) player.removeEventListener(event, callback);
      player.delete();
    }
  };
}
