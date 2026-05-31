"use strict";

const PLAYER_CONTAINER_SELECTORS = [
  "#movie_player",
  ".html5-video-player",
  "#player-container",
  "[data-a-target='video-player']",
  ".persistent-player",
  ".video-player",
  ".tw-player",
  "#live-player",
  ".live-player",
  ".bpx-player-container",
  ".bpx-player-video-wrap",
  ".bilibili-player",
  ".bilibili-player-video-wrap",
  ".web-player",
  ".video-js",
  ".jwplayer",
  ".dplayer",
  ".xgplayer",
  "#player",
  "[id*='player' i]",
  "[class*='player' i]"
];
const PLAYER_CANDIDATE_SELECTORS = [
  ...PLAYER_CONTAINER_SELECTORS,
  "video",
  "iframe[src*='player' i]",
  "iframe[src*='live' i]"
];
const primedVideos = new WeakSet();

(() => {
  const expectedOrigin = `chrome-extension://${chrome.runtime.id}`;
  const ancestorOrigins = Array.from(window.location.ancestorOrigins || []);
  const isExtensionFrame = document.referrer.startsWith(`${expectedOrigin}/`) || ancestorOrigins.includes(expectedOrigin);

  if (window.top === window || !isExtensionFrame) {
    return;
  }

  document.documentElement.classList.add("chrome-stream-layout-frame");
  installStyle();
  promoteWhenReady();

  const observer = new MutationObserver(() => {
    promoteWhenReady();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("resize", promoteWhenReady, { passive: true });
  window.setInterval(promoteWhenReady, 1500);
})();

function installStyle() {
  if (document.getElementById("chrome-stream-layout-frame-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "chrome-stream-layout-frame-style";
  style.textContent = `
    html.chrome-stream-layout-frame,
    html.chrome-stream-layout-frame body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: #000 !important;
    }

    html.chrome-stream-layout-frame.chrome-stream-layout-has-player body > :not(.chrome-stream-layout-keep):not(script):not(style):not(link) {
      display: none !important;
    }

    html.chrome-stream-layout-frame.chrome-stream-layout-has-player header,
    html.chrome-stream-layout-frame.chrome-stream-layout-has-player nav,
    html.chrome-stream-layout-frame.chrome-stream-layout-has-player aside,
    html.chrome-stream-layout-frame.chrome-stream-layout-has-player footer,
    html.chrome-stream-layout-frame.chrome-stream-layout-has-player [class*="chat" i],
    html.chrome-stream-layout-frame.chrome-stream-layout-has-player [id*="chat" i],
    html.chrome-stream-layout-frame.chrome-stream-layout-has-player [class*="sidebar" i],
    html.chrome-stream-layout-frame.chrome-stream-layout-has-player [id*="sidebar" i] {
      display: none !important;
    }

    html.chrome-stream-layout-frame .chrome-stream-layout-primary {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      width: 100vw !important;
      height: 100vh !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: #000 !important;
      object-fit: contain !important;
      transform: none !important;
    }

    html.chrome-stream-layout-frame .chrome-stream-layout-primary video,
    html.chrome-stream-layout-frame .chrome-stream-layout-primary iframe,
    html.chrome-stream-layout-frame .chrome-stream-layout-primary canvas {
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      object-fit: contain !important;
    }
  `;

  document.documentElement.append(style);
}

function promoteWhenReady() {
  const primary = findPrimaryPlayer();
  if (!primary) {
    return;
  }

  document.documentElement.classList.add("chrome-stream-layout-has-player");

  let node = primary;
  while (node && node !== document.documentElement) {
    if (node instanceof Element) {
      node.classList.add("chrome-stream-layout-keep");
    }
    node = node.parentElement;
  }

  primary.classList.add("chrome-stream-layout-primary");
  primeMediaPlayback(primary);
}

function findPrimaryPlayer() {
  const candidates = Array.from(document.querySelectorAll(PLAYER_CANDIDATE_SELECTORS.join(",")))
    .filter(isVisible)
    .map((element) => getPromotableElement(element))
    .filter(Boolean)
    .filter(isVisible);

  candidates.sort((a, b) => getArea(b) - getArea(a));

  const largest = candidates[0];
  if (!largest || getArea(largest) < 10000) {
    return null;
  }

  return largest;
}

function getPromotableElement(element) {
  const container = element.closest(PLAYER_CONTAINER_SELECTORS.join(","));
  return container || element;
}

function primeMediaPlayback(primary) {
  const videos = primary.matches("video") ? [primary] : Array.from(primary.querySelectorAll("video"));

  videos.forEach((video) => {
    if (primedVideos.has(video)) {
      return;
    }

    primedVideos.add(video);
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    const playRequest = video.play?.();
    void playRequest?.catch?.(() => {});
  });
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 40 && rect.height > 40 && style.display !== "none" && style.visibility !== "hidden";
}

function getArea(element) {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}
