"use strict";

const POINTER_ACTIVITY_THROTTLE_MS = 120;

(() => {
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  const ancestors = Array.from(location.ancestorOrigins || []);
  const isEmbeddedByExtension = window.top !== window && (
    document.referrer.startsWith(`${extensionOrigin}/`) ||
    ancestors.includes(extensionOrigin)
  );

  if (!isEmbeddedByExtension) {
    return;
  }

  let lastPointerActivityAt = 0;

  window.addEventListener("pointermove", () => {
    const now = performance.now();
    if (now - lastPointerActivityAt < POINTER_ACTIVITY_THROTTLE_MS) {
      return;
    }

    lastPointerActivityAt = now;
    window.top.postMessage({ type: "chrome-stream-layout:pointer-activity" }, extensionOrigin);
  }, { passive: true });
})();
