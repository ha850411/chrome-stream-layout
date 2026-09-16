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
  let discoveryTimer = 0;
  let suspended = false;
  let observedTitleNodes = [];

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

  function reportMediaStatus(event, force = false) {
    if (suspended) return;
    // Prefer the largest visible video, so a small preview/ad cannot replace
    // the status of the main player. Events avoid continuous DOM polling.
    const videos = Array.from(document.querySelectorAll("video"));
    let video = null;
    let area = 0;
    videos.forEach((candidate) => {
      const rect = candidate.getBoundingClientRect();
      if (rect.width * rect.height > area) {
        video = candidate;
        area = rect.width * rect.height;
      }
    });
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
    observeTitleNodes();
    reportTitle(true);
    reportMediaStatus(null, true);
  });
  document.addEventListener("yt-navigate-finish", startTitleTracking);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      startTitleTracking();
      reportMediaStatus(null, true);
    } else {
      stopDiscovery();
    }
  });
  window.addEventListener("pagehide", () => {
    suspended = true;
    titleObserver.disconnect();
    headObserver.disconnect();
    observedTitleNodes = [];
    stopDiscovery();
    window.clearTimeout(titleTimer);
    titleTimer = 0;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      startTitleTracking();
      reportMediaStatus(null, true);
    }
  });

  startTitleTracking();
  reportMediaStatus();
})();
