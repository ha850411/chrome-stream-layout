"use strict";

// The page owns its SDK and workers. Removing it also ends workers that IVS's
// delete() leaves alive. Normal source refreshes reuse the existing instance.
const kickHosts = new WeakMap();

function updateKickContext(frame) {
  const host = kickHosts.get(frame);
  if (!host?.api) return;
  host.api.setContext({ language: state.language, pane: frame.title,
    liveTitle: t("refreshStreamPane", { number: Number(frame.dataset.tileFrame) + 1 }),
    quality: t("streamQuality"), auto: t("automaticQuality"),
    loading: t("sourceLoading"), error: t("sourceMediaError") });
}

function createKickFrame(tile, sourceUrl) {
  const index = Number(tile.dataset.tile);
  const shell = document.createElement("div");
  shell.className = "tile-frame-shell";
  shell.dataset.tileFrameShell = String(index);
  const frame = document.createElement("iframe");
  frame.dataset.tileFrame = String(index);
  frame.dataset.sourceUrl = sourceUrl;
  frame.dataset.kickPlayer = "true";
  frame.title = t("pane", { number: index + 1 });
  frame.allow = "autoplay; fullscreen; picture-in-picture";
  frame.allowFullscreen = true;
  const host = { api: null, resolving: true };
  host.ready = new Promise((resolve) => { host.finish = resolve; });
  host.timer = window.setTimeout(() => host.finish(null), FRAME_LOAD_TIMEOUT_MS);
  kickHosts.set(frame, host);
  frame.addEventListener("load", () => {
    window.clearTimeout(host.timer);
    if (!frame.isConnected) return host.finish(null);
    const api = frame.contentWindow.kickPlayer;
    if (!api) return host.finish(null);
    host.api = api;
    updateKickContext(frame);
    api.bind({
      live: () => {
        if (frame.isConnected) void retryTiles([Number(tile.dataset.tile)], { goLive: true });
      },
      quality: (value) => {
        if (!frame.isConnected) return;
        state.slots[Number(tile.dataset.tile)].quality = value;
        void persistState(t("applied"));
      },
      status: (status) => {
        if (!frame.isConnected || host.resolving) return;
        if (status !== "sourceBuffering") clearFrameLoadTimer(frame);
        setTileStatus(tile, status);
      }
    });
    host.finish(api);
  }, { once: true });
  frame.src = chrome.runtime.getURL("kick-player.html");
  shell.append(frame);
  tile.replaceChildren(shell);
  return frame;
}

function disposeKickFrames(tile) {
  tile.querySelectorAll("iframe[data-kick-player]").forEach((frame) => {
    const host = kickHosts.get(frame);
    window.clearTimeout(host?.timer);
    host?.finish(null);
    host?.api?.destroy();
    clearFrameLoadTimer(frame);
    frame.remove();
    kickHosts.delete(frame);
  });
}

function loadKickTile(tile, sourceUrl, { goLive = false } = {}) {
  tileLoads.get(tile)?.controller.abort();
  let frame = tile.querySelector("iframe[data-kick-player]");
  let preferences = frame ? kickHosts.get(frame)?.api?.getPreferences() : undefined;
  if (frame && kickHosts.get(frame)?.api?.failed) {
    disposeKickFrames(tile);
    frame = null;
  }
  frame ||= createKickFrame(tile, sourceUrl);
  let host = kickHosts.get(frame);
  host.resolving = true;
  host.api?.showLoading(t("sourceResolving"));
  clearFrameLoadTimer(frame);
  setTileStatus(tile, "sourceResolving");
  const job = { controller: new AbortController() };
  tileLoads.set(tile, job);
  const current = () => tileLoads.get(tile) === job && tile.isConnected;
  job.promise = (async () => {
    try {
      const embed = await resolveEmbed(sourceUrl, job.controller.signal);
      if (!current()) return;
      let api = await host.ready;
      if (!current()) return;
      if (!api) throw new Error("Player page did not load");
      // The old stream may fail while the new URL is being fetched. Replace
      // that page before creating an engine, so its retired worker cannot linger.
      if (api.failed) {
        preferences = api.getPreferences() || preferences;
        disposeKickFrames(tile);
        frame = createKickFrame(tile, sourceUrl);
        host = kickHosts.get(frame);
        api = await host.ready;
        if (!current()) return;
        if (!api) throw new Error("Player page did not load");
      }
      host.resolving = false;
      setTileStatus(tile, "sourceLoading");
      startFrameLoadTimer(frame);
      api.load({ ...embed, ...preferences, autoplay: goLive || embed.autoplay,
        quality: state.slots[Number(tile.dataset.tile)].quality || "auto" });
      if (embed.title) setFrameSourceTitle(frame, embed.title);
    } catch (error) {
      if (!current()) return;
      const key = ["sourceTimeout", "sourceOffline"].includes(error?.code) ? error.code : "sourceFailed";
      // End the old media and its worker even when a refreshed source is offline.
      const keptPreferences = host.api?.getPreferences() || preferences;
      disposeKickFrames(tile);
      frame = createKickFrame(tile, sourceUrl);
      const failedHost = kickHosts.get(frame);
      const api = await failedHost.ready;
      if (!current()) return;
      failedHost.resolving = false;
      if (keptPreferences) api?.setPreferences(keptPreferences);
      api?.showError(t(key));
      setTileStatus(tile, key);
    } finally {
      if (tileLoads.get(tile) === job) tileLoads.delete(tile);
    }
  })();
  return job.promise;
}
