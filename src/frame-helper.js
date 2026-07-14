"use strict";

const YOUTUBE_PLAYER_SELECTORS = [
  "#movie_player.html5-video-player",
  "#movie_player",
  ".html5-video-player",
  "ytd-player",
  "#player-container",
  "#player"
];
const YESLIVE_PLAYER_SELECTORS = [
  "video",
  ".video-js",
  ".jwplayer",
  ".plyr",
  ".dplayer",
  ".xgplayer",
  ".mejs-container",
  ".epyt-video-wrapper",
  ".wp-block-embed",
  ".wp-block-video",
  ".wp-embedded-content",
  ".embed-responsive",
  ".ratio",
  ".fluid-width-video-wrapper",
  ".wp-video",
  ".dooplay_player",
  "#dooplay_player_response",
  "#player",
  ".player",
  ".player-container",
  ".video-container",
  "[id*='player' i]",
  "[class*='player' i]",
  "iframe[src*='player' i]",
  "iframe[src*='embed' i]",
  "iframe[src*='live' i]",
  "iframe[src*='stream' i]",
  "iframe[src*='video' i]",
  "iframe[src*='tv' i]",
  "iframe"
];
const YESLIVE_PROMOTABLE_CONTAINER_SELECTOR = ".video-js, .jwplayer, .plyr, .dplayer, .xgplayer, .mejs-container, .epyt-video-wrapper, .wp-block-embed, .wp-block-video, .wp-embedded-content, .embed-responsive, .ratio, .fluid-width-video-wrapper, .wp-video, .dooplay_player, #dooplay_player_response, #player, .player, .player-container, .video-container, [id*='player' i], [class*='player' i], [id*='video' i], [class*='video' i], [id*='embed' i], [class*='embed' i]";
const YESLIVE_CONTROL_SELECTOR = ".vjs-control-bar, .jw-controlbar, .plyr__controls, .dplayer-controller, .xgplayer-controls, .mejs-controls, [class*='control' i], [class*='toolbar' i]";
const YESLIVE_BAD_FRAME_PATTERN = /(?:about:blank|doubleclick|googlesyndication|googleads|adservice|adnxs|analytics|facebook|recaptcha)/i;
const YESLIVE_GOOD_FRAME_PATTERN = /(?:player|embed|live|stream|video|tv|max|m3u8)/i;
const PLAYER_MUTATION_DEBOUNCE_MS = 250;
const PLAYER_RECHECK_INTERVAL_MS = 10000;
let currentYouTubePlayer = null;
let currentYesLivePlayer = null;
let youtubePromoteTimer = 0;
let yesLivePromoteTimer = 0;

(() => {
  if (!isEmbeddedByThisExtension()) {
    return;
  }

  const hostname = location.hostname.toLowerCase();

  if (isYouTubeHost(hostname)) {
    if (isYouTubeEmbedPage()) {
      installYouTubeEmbedErrorReporter();
      return;
    }

    installYouTubePlayerOnlyHelper();
    return;
  }

  if (isYesLiveHost(hostname) && isDirectlyEmbeddedByThisExtension()) {
    installYesLiveTheaterHelper();
  }
})();

function isYouTubeEmbedPage() {
  return location.pathname.startsWith("/embed/");
}

function installYouTubeEmbedErrorReporter() {
  let reported = false;
  const reportIfFailed = () => {
    if (reported || !document.querySelector(".ytp-error, .ytp-error-content-wrap")) {
      return;
    }

    reported = true;
    observer.disconnect();
    window.top.postMessage(
      { type: "chrome-stream-layout:youtube-embed-error" },
      `chrome-extension://${chrome.runtime.id}`
    );
  };
  const observer = new MutationObserver(reportIfFailed);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  reportIfFailed();
  window.setTimeout(() => observer.disconnect(), 30000);
}

function isEmbeddedByThisExtension() {
  const expectedOrigin = `chrome-extension://${chrome.runtime.id}`;
  const ancestors = Array.from(location.ancestorOrigins || []);

  return window.top !== window && (document.referrer.startsWith(`${expectedOrigin}/`) || ancestors.includes(expectedOrigin));
}

function isDirectlyEmbeddedByThisExtension() {
  const expectedOrigin = `chrome-extension://${chrome.runtime.id}`;
  const ancestors = Array.from(location.ancestorOrigins || []);

  return window.top !== window && (document.referrer.startsWith(`${expectedOrigin}/`) || ancestors[0] === expectedOrigin);
}

function installYouTubePlayerOnlyHelper() {
  document.documentElement.classList.add("chrome-stream-layout-youtube-player-only");
  installYouTubePlayerOnlyStyle();
  promoteYouTubePlayer();

  const observer = new MutationObserver(() => {
    ensureYouTubePlayer();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("resize", ensureYouTubePlayer, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      ensureYouTubePlayer();
    }
  });
  window.setInterval(() => {
    if (!document.hidden) {
      ensureYouTubePlayer();
    }
  }, PLAYER_RECHECK_INTERVAL_MS);
}

function installYesLiveTheaterHelper() {
  document.documentElement.classList.add("chrome-stream-layout-yeslive-theater");
  installYesLiveTheaterStyle();
  scheduleYesLivePlayerPromotion();

  const observer = new MutationObserver(() => {
    if (!getCurrentYesLivePlayer()) {
      scheduleYesLivePlayerPromotion(120);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("resize", ensureYesLivePlayer, { passive: true });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "chrome-stream-layout:viewport-change") {
      ensureYesLivePlayer();
    }
  });
  document.addEventListener("fullscreenchange", ensureYesLivePlayer);
  document.addEventListener("webkitfullscreenchange", ensureYesLivePlayer);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      ensureYesLivePlayer();
    }
  });
  window.setInterval(() => {
    if (!document.hidden) {
      ensureYesLivePlayer(true);
    }
  }, PLAYER_RECHECK_INTERVAL_MS);
}

function installYouTubePlayerOnlyStyle() {
  if (document.getElementById("chrome-stream-layout-youtube-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "chrome-stream-layout-youtube-style";
  style.textContent = `
    html.chrome-stream-layout-youtube-player-only,
    html.chrome-stream-layout-youtube-player-only body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: #000 !important;
    }

    html.chrome-stream-layout-youtube-has-player body * {
      visibility: hidden !important;
    }

    html.chrome-stream-layout-youtube-has-player .chrome-stream-layout-youtube-primary,
    html.chrome-stream-layout-youtube-has-player .chrome-stream-layout-youtube-primary * {
      visibility: visible !important;
    }

    html.chrome-stream-layout-youtube-player-only .chrome-stream-layout-youtube-primary {
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
      transform: none !important;
      overflow: hidden !important;
    }

    html.chrome-stream-layout-youtube-player-only .chrome-stream-layout-youtube-primary .html5-video-container,
    html.chrome-stream-layout-youtube-player-only .chrome-stream-layout-youtube-primary .ytp-cued-thumbnail-overlay {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      overflow: hidden !important;
      background: #000 !important;
    }

    html.chrome-stream-layout-youtube-player-only .chrome-stream-layout-youtube-primary video,
    html.chrome-stream-layout-youtube-player-only .chrome-stream-layout-youtube-primary .html5-main-video {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      margin: auto !important;
      transform: none !important;
      object-fit: contain !important;
      object-position: center center !important;
      background: #000 !important;
    }

    html.chrome-stream-layout-youtube-player-only .chrome-stream-layout-youtube-primary .ytp-cued-thumbnail-overlay-image {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      background-size: contain !important;
      background-position: center center !important;
      background-repeat: no-repeat !important;
    }
  `;

  document.documentElement.append(style);
}

function installYesLiveTheaterStyle() {
  if (document.getElementById("chrome-stream-layout-yeslive-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "chrome-stream-layout-yeslive-style";
  style.textContent = `
    html.chrome-stream-layout-yeslive-theater,
    html.chrome-stream-layout-yeslive-theater body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: #000 !important;
    }

    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary {
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
      opacity: 1 !important;
      visibility: visible !important;
      background: #000 !important;
      transform: none !important;
      overflow: hidden !important;
      pointer-events: auto !important;
    }

    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary.chrome-stream-layout-yeslive-media,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary:is(iframe, video, canvas, object, embed),
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary > iframe,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary > video,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary > canvas,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary > object,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary > embed,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .video-js,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .jwplayer,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .plyr,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .dplayer,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .xgplayer,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .mejs-container {
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      border: 0 !important;
      background: #000 !important;
      object-fit: contain !important;
      object-position: center center !important;
      transform: none !important;
    }

    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary video {
      max-width: 100% !important;
      max-height: 100% !important;
      object-fit: contain !important;
      object-position: center center !important;
      background: #000 !important;
    }

    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .vjs-control-bar,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .jw-controlbar,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .plyr__controls,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .dplayer-controller,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .xgplayer-controls,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary .mejs-controls,
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary [class*="control" i],
    html.chrome-stream-layout-yeslive-theater .chrome-stream-layout-yeslive-primary [class*="toolbar" i] {
      pointer-events: auto !important;
      z-index: 2147483647 !important;
    }
  `;

  document.documentElement.append(style);
}

function promoteYouTubePlayer() {
  const player = findYouTubePlayer();
  if (!player) {
    currentYouTubePlayer = null;
    document.documentElement.classList.remove("chrome-stream-layout-youtube-has-player");
    return;
  }

  document.querySelectorAll(".chrome-stream-layout-youtube-primary").forEach((element) => {
    if (element !== player) {
      element.classList.remove("chrome-stream-layout-youtube-primary");
    }
  });

  player.classList.add("chrome-stream-layout-youtube-primary");
  currentYouTubePlayer = player;
  document.documentElement.classList.add("chrome-stream-layout-youtube-has-player");

  const video = player.matches("video") ? player : player.querySelector("video");
  if (video) {
    video.playsInline = true;
    video.setAttribute("playsinline", "");
  }

  window.dispatchEvent(new Event("resize"));
}

function ensureYouTubePlayer() {
  if (getCurrentYouTubePlayer() || youtubePromoteTimer) {
    return;
  }

  youtubePromoteTimer = window.setTimeout(() => {
    youtubePromoteTimer = 0;
    if (!getCurrentYouTubePlayer()) {
      promoteYouTubePlayer();
    }
  }, PLAYER_MUTATION_DEBOUNCE_MS);
}

function getCurrentYouTubePlayer() {
  if (!currentYouTubePlayer?.isConnected) {
    currentYouTubePlayer = null;
  }

  return currentYouTubePlayer;
}

function promoteYesLivePlayer() {
  const previousPlayers = Array.from(document.querySelectorAll(".chrome-stream-layout-yeslive-primary"));
  previousPlayers.forEach(clearYesLivePlayerMark);
  currentYesLivePlayer = null;
  document.documentElement.classList.remove("chrome-stream-layout-yeslive-has-player");

  const player = findYesLivePlayer() || previousPlayers.find(isUsableYesLivePlayer);
  if (!player) {
    return;
  }

  document.querySelectorAll(".chrome-stream-layout-yeslive-primary").forEach((element) => {
    if (element !== player) {
      clearYesLivePlayerMark(element);
    }
  });

  player.classList.add("chrome-stream-layout-yeslive-primary");
  player.classList.toggle("chrome-stream-layout-yeslive-media", player.matches("iframe, video, canvas, object, embed"));
  currentYesLivePlayer = player;
  document.documentElement.classList.add("chrome-stream-layout-yeslive-has-player");

  const video = player.matches("video") ? player : player.querySelector("video");
  if (video) {
    video.playsInline = true;
    video.setAttribute("playsinline", "");
  }
}

function clearYesLivePlayerMark(element) {
  element.classList.remove("chrome-stream-layout-yeslive-primary");
  element.classList.remove("chrome-stream-layout-yeslive-media");
}

function scheduleYesLivePlayerPromotion(delay = 0) {
  if (yesLivePromoteTimer) {
    return;
  }

  yesLivePromoteTimer = window.setTimeout(() => {
    yesLivePromoteTimer = 0;
    if (!getCurrentYesLivePlayer()) {
      promoteYesLivePlayer();
    }
  }, delay);
}

function ensureYesLivePlayer(validateCurrent = false) {
  const player = getCurrentYesLivePlayer();
  if (player && (!validateCurrent || isUsableYesLivePlayer(player))) {
    return;
  }

  currentYesLivePlayer = null;
  scheduleYesLivePlayerPromotion(PLAYER_MUTATION_DEBOUNCE_MS);
}

function getCurrentYesLivePlayer() {
  if (!currentYesLivePlayer?.isConnected) {
    currentYesLivePlayer = null;
  }

  return currentYesLivePlayer;
}

function isUsableYesLivePlayer(player) {
  return Boolean(
    player?.isConnected &&
    isVisibleEnough(player) &&
    !isLikelyAdElement(player) &&
    (hasMediaSurface(player) || player.matches("video, iframe, object, embed, canvas"))
  );
}

function findYouTubePlayer() {
  for (const selector of YOUTUBE_PLAYER_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter(isVisibleEnough);
    if (!candidates.length) {
      continue;
    }

    candidates.sort((a, b) => getArea(b) - getArea(a));
    return candidates[0];
  }

  return null;
}

function findYesLivePlayer() {
  const candidates = YESLIVE_PLAYER_SELECTORS
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .map(getYesLivePromotableElement)
    .filter(Boolean)
    .filter(isVisibleEnough)
    .filter((element) => hasMediaSurface(element) || element.matches("video, iframe, object, embed, canvas"));

  const rankedCandidates = Array.from(new Set(candidates))
    .map((element) => ({
      element,
      score: getYesLiveCandidateScore(element)
    }))
    .filter((candidate) => candidate.score > 0);

  rankedCandidates.sort((a, b) => b.score - a.score);

  return rankedCandidates[0]?.element || null;
}

function getYesLivePromotableElement(element) {
  if (element.matches("video, iframe, object, embed, canvas")) {
    return findYesLivePlayerShell(element) || element;
  }

  return element;
}

function findYesLivePlayerShell(mediaElement) {
  const mediaArea = getArea(mediaElement);
  let best = mediaElement;
  let current = mediaElement.parentElement;
  let depth = 0;

  while (current && current !== document.documentElement && current !== document.body && depth < 8) {
    if (isVisibleEnough(current) && !isLikelyAdElement(current)) {
      const currentArea = getArea(current);
      const canContainPlayer = current.matches(YESLIVE_PROMOTABLE_CONTAINER_SELECTOR) || hasPlayerAffordance(current);
      const isStillNearMedia = mediaArea < 10000 || currentArea <= Math.max(mediaArea * 2.2, 420000);

      if (canContainPlayer && isStillNearMedia) {
        best = current;
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  return best;
}

function getYesLiveCandidateScore(element) {
  const area = getArea(element);
  if (area < 10000 || isLikelyAdElement(element)) {
    return 0;
  }

  const video = element.matches("video") ? element : element.querySelector("video");
  if (video && isVisibleEnough(video)) {
    if (video.readyState > 0 || video.videoWidth > 0 || video.videoHeight > 0) {
      return area + 1100000000;
    }

    if (element !== video && hasPlayerAffordance(element)) {
      return area + 900000000;
    }

    return 0;
  }

  const frame = element.matches("iframe") ? element : element.querySelector("iframe");
  if (frame && isVisibleEnough(frame) && isPotentialYesLivePlayerFrame(frame)) {
    return area + (isLikelyYesLivePlayerFrame(frame) ? 70000000 : 35000000);
  }

  if (element.matches("object, embed, canvas")) {
    return area + 20000000;
  }

  if (hasPlayerAffordance(element)) {
    return area + 10000000;
  }

  return 0;
}

function hasPlayerAffordance(element) {
  return element.matches(YESLIVE_PROMOTABLE_CONTAINER_SELECTOR) || Boolean(element.querySelector(`${YESLIVE_CONTROL_SELECTOR}, button, [role='button'], .play, [class*='play' i], [id*='play' i]`));
}

function isLikelyYesLivePlayerFrame(frame) {
  const src = frame.getAttribute("src") || frame.src || "";
  return Boolean(src) && !YESLIVE_BAD_FRAME_PATTERN.test(src) && YESLIVE_GOOD_FRAME_PATTERN.test(src);
}

function isPotentialYesLivePlayerFrame(frame) {
  const src = frame.getAttribute("src") || frame.src || "";
  return Boolean(src) && !YESLIVE_BAD_FRAME_PATTERN.test(src);
}

function isLikelyAdElement(element) {
  const text = `${element.id || ""} ${element.className || ""} ${element.getAttribute("src") || ""}`;
  return /\b(?:ad|ads|banner|promo|pop|recommend)\b/i.test(text);
}

function hasMediaSurface(element) {
  return Boolean(element.querySelector("video, iframe, object, embed, canvas"));
}

function isVisibleEnough(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 80 && rect.height > 80 && style.display !== "none";
}

function getArea(element) {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}

function isYouTubeHost(hostname) {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
}

function isYesLiveHost(hostname) {
  return hostname === "yes2049.com" || hostname.endsWith(".yes2049.com") || hostname === "yeslivetv.com" || hostname.endsWith(".yeslivetv.com") || hostname === "welife6.com" || hostname.endsWith(".welife6.com");
}
