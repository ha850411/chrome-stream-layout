"use strict";

(() => {
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  const ancestors = Array.from(location.ancestorOrigins || []);
  if (window.top === window || !(document.referrer.startsWith(`${extensionOrigin}/`) || ancestors[0] === extensionOrigin)) {
    return;
  }

  const hostname = location.hostname.toLowerCase();
  const isYouTube = hostname === "youtube.com" || hostname.endsWith(".youtube.com") ||
    hostname === "youtube-nocookie.com" || hostname.endsWith(".youtube-nocookie.com");
  let lastReportedTitle = null;
  let lastMediaStatus = null;
  let titleTimer = 0;
  let mediaTimer = 0;
  let discoveryTimer = 0;
  let suspended = false;
  let observedTitleNodes = [];
  let trackedVideo = null;
  let mediaDiscoveryTimer = 0;
  let mediaPollTimer = 0;

  const send = (type, payload) => window.top.postMessage({ type, ...payload }, extensionOrigin);
  const reportTitle = (force = false) => {
    const playerTitle = isYouTube ? document.querySelector(".ytp-title-link") : null;
    const metadata = isYouTube ? document.querySelector('meta[name="title"], meta[property="og:title"]') : null;
    const title = (playerTitle?.textContent?.trim() || playerTitle?.getAttribute("aria-label") ||
      playerTitle?.getAttribute("title") || metadata?.content || document.title).replace(/\s+/g, " ").trim().slice(0, 300);
    if (!force && title === lastReportedTitle) return;
    lastReportedTitle = title;
    send("chrome-stream-layout:frame-title", { title });
  };

  const titleObserver = new MutationObserver(() => scheduleTitleReport());
  // Only watch direct head children for replacement of title/meta elements.
  const headObserver = new MutationObserver(() => scheduleTitleReport());
  const discoveryObserver = new MutationObserver(() => scheduleTitleReport());
  // Coalesce first, then search once. Once a player exists, watch only its
  // ancestor chain for removal; chat and recommendation subtrees stay unwatched.
  const mediaObserver = new MutationObserver(() => {
    if (!trackedVideo?.isConnected) scheduleMediaReport();
  });

  function scheduleMediaReport() {
    if (suspended || mediaTimer) return;
    mediaTimer = window.setTimeout(() => {
      mediaTimer = 0;
      reportMediaStatus(null, false, true);
    }, 250);
  }

  function observeMedia(video) {
    mediaObserver.disconnect();
    window.clearTimeout(mediaDiscoveryTimer);
    mediaDiscoveryTimer = 0;
    if (video) {
      for (let node = video.parentElement; node; node = node.parentElement) {
        mediaObserver.observe(node, { childList: true });
      }
    } else {
      mediaObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
      mediaDiscoveryTimer = window.setTimeout(() => {
        mediaObserver.disconnect();
        mediaDiscoveryTimer = 0;
      }, 30000);
    }
  }

  function pollMedia() {
    if (suspended) return;
    reportMediaStatus(null, false, true);
    // Late paused players and visibility changes still get detected after the
    // bounded discovery period, without a permanent whole-document observer.
    mediaPollTimer = window.setTimeout(pollMedia, 10000);
  }

  function startMediaTracking() {
    stopMediaTracking();
    trackedVideo = null;
    observeMedia(null);
    reportMediaStatus(null, true, true);
    mediaPollTimer = window.setTimeout(pollMedia, 10000);
  }

  function stopMediaTracking() {
    mediaObserver.disconnect();
    window.clearTimeout(mediaTimer);
    window.clearTimeout(mediaDiscoveryTimer);
    window.clearTimeout(mediaPollTimer);
    mediaTimer = mediaDiscoveryTimer = mediaPollTimer = 0;
  }

  function stopDiscovery() {
    discoveryObserver.disconnect();
    window.clearTimeout(discoveryTimer);
    discoveryTimer = 0;
  }

  function observeTitleNodes() {
    const nodes = [document.querySelector("title")];
    if (isYouTube) nodes.push(document.querySelector(".ytp-title-link"),
      document.querySelector('meta[name="title"], meta[property="og:title"]'));
    const current = nodes.filter(Boolean);
    if (current.length !== observedTitleNodes.length || current.some((node, i) => node !== observedTitleNodes[i])) {
      titleObserver.disconnect();
      current.forEach((node) => titleObserver.observe(node, {
        childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ["content", "title", "aria-label"]
      }));
      observedTitleNodes = current;
    }
    if (isYouTube && nodes[1]) stopDiscovery();
  }

  function scheduleTitleReport() {
    if (suspended || titleTimer) return;
    titleTimer = window.setTimeout(() => {
      titleTimer = 0;
      observeTitleNodes();
      reportTitle();
    }, 250);
  }

  function startTitleTracking() {
    if (document.hidden) return;
    suspended = false;
    if (document.head) headObserver.observe(document.head, { childList: true });
    observeTitleNodes();
    stopDiscovery();
    if (isYouTube && !document.querySelector(".ytp-title-link")) {
      discoveryObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
      discoveryTimer = window.setTimeout(stopDiscovery, 30000);
    }
    reportTitle(true);
  }

  function reportMediaStatus(event, force = false, rescan = false) {
    if (suspended) return;
    if (rescan || !trackedVideo?.isConnected || (event && event.target !== trackedVideo)) {
      let selected = null;
      let area = 0;
      document.querySelectorAll("video").forEach((candidate) => {
        const rect = candidate.getBoundingClientRect();
        if (rect.width * rect.height > area) { selected = candidate; area = rect.width * rect.height; }
      });
      if (selected !== trackedVideo) {
        trackedVideo = selected;
        observeMedia(trackedVideo);
      }
    }
    const video = trackedVideo;
    if (event && event.target !== video) return;
    const status = !video ? "sourcePageLoaded" : video.error ? "sourceMediaError" :
      video.paused || video.ended ? "sourcePaused" :
      video.readyState < 3 || ["waiting", "stalled"].includes(event?.type) ? "sourceBuffering" : "sourcePlaying";
    if (!force && status === lastMediaStatus) return;
    lastMediaStatus = status;
    send("chrome-stream-layout:media-status", { status });
  }

  ["playing", "pause", "waiting", "stalled", "error", "ended", "emptied", "loadeddata"].forEach((type) => {
    document.addEventListener(type, (event) => reportMediaStatus(event), true);
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window.top || event.origin !== extensionOrigin ||
        event.data?.type !== "chrome-stream-layout:request-title") return;
    if (suspended) return;
    observeTitleNodes();
    reportTitle(true);
    reportMediaStatus(null, true, true);
  });
  document.addEventListener("yt-navigate-finish", startTitleTracking);
  function suspendTracking() {
    suspended = true;
    titleObserver.disconnect();
    headObserver.disconnect();
    observedTitleNodes = [];
    stopDiscovery();
    stopMediaTracking();
    window.clearTimeout(titleTimer);
    titleTimer = 0;
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      startTitleTracking();
      startMediaTracking();
    } else {
      suspendTracking();
    }
  });
  window.addEventListener("pagehide", suspendTracking);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      startTitleTracking();
      startMediaTracking();
    }
  });

  if (!document.hidden) { startTitleTracking(); startMediaTracking(); }
  else suspended = true;
})();
