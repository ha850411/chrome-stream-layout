"use strict";

(() => {
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  const ancestors = Array.from(location.ancestorOrigins || []);
  const isDirectlyEmbeddedByExtension = window.top !== window && (
    document.referrer.startsWith(`${extensionOrigin}/`) ||
    ancestors[0] === extensionOrigin
  );

  if (!isDirectlyEmbeddedByExtension) {
    return;
  }

  let lastReportedTitle = null;

  const getPageTitle = () => {
    const hostname = location.hostname.toLowerCase();
    if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      const playerTitleElement = document.querySelector(".ytp-title-link");
      const playerTitle = playerTitleElement?.textContent ||
        playerTitleElement?.getAttribute("aria-label") ||
        playerTitleElement?.getAttribute("title");
      if (playerTitle?.trim()) {
        return playerTitle;
      }

      const metadataTitle = document.querySelector('meta[name="title"], meta[property="og:title"]')?.content;
      if (metadataTitle?.trim()) {
        return metadataTitle;
      }
    }

    return document.title;
  };

  const reportTitle = (force = false) => {
    const title = getPageTitle().replace(/\s+/g, " ").trim();
    if (!force && title === lastReportedTitle) {
      return;
    }

    lastReportedTitle = title;
    window.top.postMessage({
      type: "chrome-stream-layout:frame-title",
      title
    }, extensionOrigin);
  };

  const titleObserver = new MutationObserver(() => reportTitle());
  titleObserver.observe(document.head || document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });

  const hostname = location.hostname.toLowerCase();
  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
    const observePlayerTitle = () => {
      const playerTitle = document.querySelector(".ytp-title-link");
      if (!playerTitle) {
        return false;
      }

      const playerTitleObserver = new MutationObserver(() => reportTitle());
      playerTitleObserver.observe(playerTitle, {
        childList: true,
        characterData: true,
        subtree: true
      });
      reportTitle();
      return true;
    };

    if (!observePlayerTitle()) {
      const playerTitleDiscoveryObserver = new MutationObserver(() => {
        if (observePlayerTitle()) {
          playerTitleDiscoveryObserver.disconnect();
        }
      });
      playerTitleDiscoveryObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (
      event.source === window.top &&
      event.origin === extensionOrigin &&
      event.data?.type === "chrome-stream-layout:request-title"
    ) {
      reportTitle(true);
    }
  });

  reportTitle();
})();
