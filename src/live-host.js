"use strict";

// The page owns its SDK and workers. Removing it also ends workers that IVS's
// delete() leaves alive. Normal source refreshes reuse the existing instance.
const liveHosts = new WeakMap();
const liveRecoveries = new WeakMap();

function getLiveRecovery(tile, sourceUrl) {
  if (liveRecoveries.has(tile)) return liveRecoveries.get(tile);
  const current = () => tile.isConnected && tile.dataset.sourceUrl === sourceUrl && liveRecoveries.get(tile) === recovery;
  const api = () => liveHosts.get(tile.querySelector("iframe[data-live-player]"))?.api;
  const recovery = createLiveRecovery({
    read: () => ({ ...api()?.getHealth(), alive: current(), visible: !document.hidden, online: navigator.onLine }),
    retry: () => {
      if (current()) void loadLiveTile(tile, sourceUrl, { goLive: true, automatic: true, rebuild: true });
    },
    report: (status, terminal) => {
      if (!current()) return;
      if (terminal) api()?.showError(t(status));
      else api()?.showNotice(t(status));
      setTileStatus(tile, status);
    }
  });
  liveRecoveries.set(tile, recovery);
  return recovery;
}

function disposeLiveRecovery(tile) {
  liveRecoveries.get(tile)?.destroy();
  liveRecoveries.delete(tile);
}

function updateLiveContext(frame) {
  const host = liveHosts.get(frame);
  if (!host?.api) return;
  host.api.setContext({ language: state.language, pane: frame.getAttribute("aria-label"),
    platform: getTwitchLiveChannel(parseUrl(frame.dataset.sourceUrl)) ? "twitch" : "kick",
    liveTitle: t("refreshStreamPane", { number: Number(frame.dataset.tileFrame) + 1 }),
    quality: t("streamQuality"), auto: t("automaticQuality"),
    loading: t("sourceLoading"), error: t("sourceMediaError") });
  if (liveRecoveries.get(frame.closest("[data-tile]"))?.waiting) {
    host.api.showNotice(t(frame.closest("[data-tile]").dataset.status));
  }
}

function createLiveFrame(tile, sourceUrl) {
  const index = Number(tile.dataset.tile);
  const shell = document.createElement("div");
  shell.className = "tile-frame-shell";
  shell.dataset.tileFrameShell = String(index);
  const frame = document.createElement("iframe");
  frame.dataset.tileFrame = String(index);
  frame.dataset.sourceUrl = sourceUrl;
  frame.dataset.livePlayer = "true";
  frame.setAttribute("aria-label", t("pane", { number: index + 1 }));
  frame.allow = "autoplay; fullscreen; picture-in-picture";
  frame.allowFullscreen = true;
  const host = { api: null, resolving: true };
  host.ready = new Promise((resolve) => { host.finish = resolve; });
  host.timer = window.setTimeout(() => host.finish(null), FRAME_LOAD_TIMEOUT_MS);
  liveHosts.set(frame, host);
  frame.addEventListener("load", () => {
    window.clearTimeout(host.timer);
    if (!frame.isConnected) return host.finish(null);
    const api = frame.contentWindow.livePlayer;
    if (!api) return host.finish(null);
    host.api = api;
    updateLiveContext(frame);
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
        const recovery = liveRecoveries.get(tile);
        if (status === "sourcePaused") recovery?.pause();
        else if (recovery?.waiting) return;
        setTileStatus(tile, status);
      },
      failure: (error) => {
        if (frame.isConnected && !host.resolving) liveRecoveries.get(tile)?.fail(error);
      }
    });
    host.finish(api);
  }, { once: true });
  frame.src = chrome.runtime.getURL("live-player.html");
  shell.append(frame);
  tile.replaceChildren(shell);
  return frame;
}

function disposeLiveFrames(tile) {
  tile.querySelectorAll("iframe[data-live-player]").forEach((frame) => {
    const host = liveHosts.get(frame);
    window.clearTimeout(host?.timer);
    host?.finish(null);
    host?.api?.destroy();
    clearFrameLoadTimer(frame);
    frame.remove();
    liveHosts.delete(frame);
  });
}

function loadLiveTile(tile, sourceUrl, { goLive = false, automatic = false, rebuild = false } = {}) {
  const recovery = getLiveRecovery(tile, sourceUrl);
  recovery.begin({ automatic, autoplay: goLive || parseUrl(sourceUrl)?.searchParams.get("autoplay") !== "false" });
  tileLoads.get(tile)?.controller.abort();
  let frame = tile.querySelector("iframe[data-live-player]");
  let preferences = frame ? liveHosts.get(frame)?.api?.getPreferences() : undefined;
  if (frame && (rebuild || liveHosts.get(frame)?.api?.failed)) {
    disposeLiveFrames(tile);
    frame = null;
  }
  frame ||= createLiveFrame(tile, sourceUrl);
  let host = liveHosts.get(frame);
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
        disposeLiveFrames(tile);
        frame = createLiveFrame(tile, sourceUrl);
        host = liveHosts.get(frame);
        api = await host.ready;
        if (!current()) return;
        if (!api) throw new Error("Player page did not load");
      }
      host.resolving = false;
      setTileStatus(tile, "sourceLoading");
      recovery.loaded();
      api.load({ ...embed, ...preferences, autoplay: goLive || embed.autoplay,
        quality: state.slots[Number(tile.dataset.tile)].quality || "auto" });
      if (embed.title) setFrameSourceTitle(frame, embed.title);
    } catch (error) {
      if (!current()) return;
      const key = ["sourceTimeout", "sourceOffline", "sourceRestricted"].includes(error?.code) ? error.code : "sourceFailed";
      // End the old media and its worker even when a refreshed source is offline.
      const keptPreferences = host.api?.getPreferences() || preferences;
      disposeLiveFrames(tile);
      frame = createLiveFrame(tile, sourceUrl);
      const failedHost = liveHosts.get(frame);
      const api = await failedHost.ready;
      if (!current()) return;
      failedHost.resolving = false;
      if (keptPreferences) api?.setPreferences(keptPreferences);
      api?.showError(t(key));
      setTileStatus(tile, key);
      recovery.fail({ code: key, retryable: error?.retryable, retryAfterMs: error?.retryAfterMs });
    } finally {
      if (tileLoads.get(tile) === job) tileLoads.delete(tile);
    }
  })();
  return job.promise;
}
