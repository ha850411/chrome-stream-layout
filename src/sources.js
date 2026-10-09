"use strict";

const SOURCE_RESOLVE_TIMEOUT_MS = 8000;
const BILIBILI_ROOM_INIT_ENDPOINT = "https://api.live.bilibili.com/room/v1/Room/room_init";
const BILIBILI_ROOM_INFO_ENDPOINT = "https://api.live.bilibili.com/room/v1/Room/get_info";
const YESLIVE_THEATER_VIEWPORT = {
  width: 1920,
  height: 1080
};
const bilibiliRoomIdCache = new Map();

async function resolveEmbed(rawUrl, signal) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) {
    return { ok: false, errorKey: "enterCompleteUrl", message: t("enterCompleteUrl") };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, errorKey: "httpOnly", message: t("httpOnly") };
  }

  const youtubeEmbed = getYouTubeEmbedUrl(parsed);
  if (youtubeEmbed) {
    return {
      ok: true,
      src: youtubeEmbed,
      fallbackSrc: parsed.href,
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  const bilibiliLivePlayer = await getBilibiliLivePlayerUrl(parsed);
  if (bilibiliLivePlayer) {
    return {
      ok: true,
      src: bilibiliLivePlayer,
      bilibiliRoomId: new URL(bilibiliLivePlayer).searchParams.get("cid"),
      referrerPolicy: "no-referrer-when-downgrade"
    };
  }

  const twitchChannel = getTwitchLiveChannel(parsed);
  if (twitchChannel) {
    const stream = await fetchTwitchLiveStream(twitchChannel, signal);
    return {
      ok: true,
      src: stream.url,
      title: stream.title,
      livePlayer: true,
      autoplay: parsed.searchParams.get("autoplay") !== "false",
      muted: parsed.searchParams.get("muted") !== "false"
    };
  }

  const huyaLivePlayer = getHuyaLivePlayerUrl(parsed);
  if (huyaLivePlayer) {
    return {
      ok: true,
      src: huyaLivePlayer,
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  const kickChannel = getKickLiveChannel(parsed);
  if (kickChannel) {
    const stream = await fetchKickLiveStream(kickChannel, signal);
    return {
      ok: true,
      src: stream.url,
      title: stream.title,
      livePlayer: true,
      autoplay: parsed.searchParams.get("autoplay") !== "false",
      muted: parsed.searchParams.get("muted") !== "false"
    };
  }

  const soopLivePlayer = getSoopLivePlayerUrl(parsed);
  if (soopLivePlayer) {
    return {
      ok: true,
      src: soopLivePlayer,
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  if (isYesLiveHost(parsed.hostname.toLowerCase())) {
    return {
      ok: true,
      src: parsed.href,
      compatibility: true,
      fixedViewport: YESLIVE_THEATER_VIEWPORT,
      referrerPolicy: "strict-origin-when-cross-origin"
    };
  }

  return {
    ok: true,
    src: parsed.href,
    compatibility: !isOfficialEmbed(parsed),
    referrerPolicy: "strict-origin-when-cross-origin"
  };
}

function getYouTubeEmbedUrl(url) {
  const hostname = url.hostname.toLowerCase();
  if (!isYouTubeHost(hostname)) {
    return "";
  }

  const videoId = getYouTubeVideoId(url);
  const playlistId = url.searchParams.get("list") || (url.pathname === "/playlist" ? url.searchParams.get("list") : "");
  if (!videoId && !playlistId) {
    return "";
  }

  const embedUrl = new URL(
    videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : "https://www.youtube.com/embed/videoseries"
  );
  embedUrl.searchParams.set("autoplay", "1");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("rel", "0");
  embedUrl.searchParams.set("origin", location.origin);
  embedUrl.searchParams.set("widget_referrer", location.href);

  if (playlistId) {
    embedUrl.searchParams.set("list", playlistId);
  }

  copyYouTubeParam(url, embedUrl, "index");
  copyYouTubeParam(url, embedUrl, "loop");
  copyYouTubeParam(url, embedUrl, "si");

  const startSeconds = getYouTubeStartSeconds(url);
  if (startSeconds > 0) {
    embedUrl.searchParams.set("start", String(startSeconds));
  }

  return embedUrl.href;
}

function getYouTubeVideoId(url) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be") {
    return sanitizeYouTubeId(url.pathname.split("/").filter(Boolean)[0]);
  }

  const queryVideoId = sanitizeYouTubeId(url.searchParams.get("v"));
  if (queryVideoId) {
    return queryVideoId;
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (["embed", "live", "shorts", "v"].includes(pathParts[0])) {
    return sanitizeYouTubeId(pathParts[1]);
  }

  return "";
}

function sanitizeYouTubeId(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(normalized) ? normalized : "";
}

function copyYouTubeParam(source, destination, name) {
  const value = source.searchParams.get(name);
  if (value) {
    destination.searchParams.set(name, value);
  }
}

function getYouTubeStartSeconds(url) {
  const value = url.searchParams.get("start") || url.searchParams.get("t") || "";
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match || !match[0]) {
    return 0;
  }

  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function getSourceLabel(rawUrl) {
  if (!rawUrl.trim()) return "";

  const parsed = parseUrl(rawUrl);
  if (!parsed) return "URL";

  const hostname = parsed.hostname.toLowerCase();
  if (isYouTubeHost(hostname)) return "YouTube";
  if (isTwitchHost(hostname)) return "Twitch";
  if (isBilibiliHost(hostname)) return "Bilibili";
  if (isYesLiveHost(hostname)) return "YesLive";
  if (isHuyaHost(hostname)) return "Huya";
  if (isKickHost(hostname)) return "Kick";
  if (isSoopHost(hostname)) return "SOOP";
  if (isDirectMediaUrl(parsed)) return getMediaLabel(parsed);
  return hostname || "URL";
}

function getMediaLabel(url) {
  const extension = getPathExtension(url);
  return extension ? `${t("video")} .${extension}` : t("video");
}

function parseUrl(rawUrl) {
  const value = rawUrl.trim();
  if (!value) return null;

  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

async function getBilibiliLivePlayerUrl(url) {
  if (!isBilibiliHost(url.hostname.toLowerCase())) {
    return "";
  }

  const roomId = getBilibiliLiveRoomId(url);
  if (!roomId) {
    return "";
  }

  const resolvedRoomId = await resolveBilibiliLiveRoomId(roomId);
  if (!resolvedRoomId) {
    return "";
  }

  const playerUrl = new URL("https://www.bilibili.com/blackboard/live/live-activity-player.html");
  playerUrl.searchParams.set("cid", resolvedRoomId);
  playerUrl.searchParams.set("mute", "1");
  playerUrl.searchParams.set("danmaku", "1");
  playerUrl.searchParams.set("fullscreen", "1");
  playerUrl.searchParams.set("quality", "1");
  playerUrl.searchParams.set("sendpanel", "0");
  playerUrl.searchParams.set("recommend", "0");
  playerUrl.searchParams.set("logo", "0");
  playerUrl.searchParams.set("enableAutoPlayTips", "0");
  return playerUrl.href;
}

async function resolveBilibiliLiveRoomId(roomId) {
  if (!isNumericId(roomId)) {
    return "";
  }

  if (bilibiliRoomIdCache.has(roomId)) {
    return bilibiliRoomIdCache.get(roomId);
  }

  const request = fetchBilibiliLiveRoomId(roomId);
  bilibiliRoomIdCache.set(roomId, request);
  try {
    return await request;
  } catch (error) {
    // Do not let an older failed request remove a newer retry's cache entry.
    if (bilibiliRoomIdCache.get(roomId) === request) bilibiliRoomIdCache.delete(roomId);
    throw error;
  }
}

async function fetchBilibiliLiveRoomId(roomId) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SOURCE_RESOLVE_TIMEOUT_MS);
  try {
    const apiUrl = new URL(BILIBILI_ROOM_INIT_ENDPOINT);
    apiUrl.searchParams.set("id", roomId);

    const response = await fetch(apiUrl.href, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error("Room lookup failed.");
    }

    const payload = await response.json();
    const resolvedRoomId = payload?.data?.room_id;
    if ((payload.code !== undefined && payload.code !== 0) || !isNumericId(resolvedRoomId) || Number(resolvedRoomId) <= 0) {
      throw new Error("Invalid room lookup response.");
    }
    return String(resolvedRoomId);
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("Room lookup timed out."), { code: "sourceTimeout" });
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchBilibiliLiveTitle(roomId) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SOURCE_RESOLVE_TIMEOUT_MS);
  try {
    const apiUrl = new URL(BILIBILI_ROOM_INFO_ENDPOINT);
    apiUrl.searchParams.set("room_id", roomId);
    const response = await fetch(apiUrl.href, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Room title lookup failed.");
    const payload = await response.json();
    const title = typeof payload?.data?.title === "string" ? normalizePageTitle(payload.data.title) : "";
    if (payload.code !== 0 || String(payload?.data?.room_id) !== roomId || !title) {
      throw new Error("Invalid room title response.");
    }
    return title;
  } finally {
    window.clearTimeout(timer);
  }
}

function getBilibiliLiveRoomId(url) {
  const fromQuery = url.searchParams.get("roomId") || url.searchParams.get("room_id") || url.searchParams.get("cid");
  if (isNumericId(fromQuery)) {
    return fromQuery;
  }

  if (url.hostname.toLowerCase() !== "live.bilibili.com") {
    return "";
  }

  const [firstPathPart] = url.pathname.split("/").filter(Boolean);
  return isNumericId(firstPathPart) ? firstPathPart : "";
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
}

function isDirectMediaUrl(url) {
  return /^(mp4|m4v|webm|ogv|ogg|mov|m3u8|mpd)$/i.test(getPathExtension(url));
}

function getPathExtension(url) {
  let path = url.pathname || "";
  try {
    path = decodeURIComponent(path);
  } catch {
    // A URL can contain a literal '%' or incomplete UTF-8 escape sequence.
    // Labels must never prevent the remaining sources from loading.
  }
  path = path.toLowerCase();
  const match = path.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function isYouTubeHost(hostname) {
  return hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname.endsWith(".youtube-nocookie.com");
}

function isTwitchHost(hostname) {
  return hostname === "twitch.tv" || hostname.endsWith(".twitch.tv") || hostname === "player.twitch.tv";
}

function isKickHost(hostname) {
  return hostname === "kick.com" || hostname.endsWith(".kick.com");
}

function isLocalLiveSource(url) {
  return Boolean(getKickLiveChannel(url) || getTwitchLiveChannel(url));
}

function getKickLiveChannel(url) {
  if (!url || !["kick.com", "www.kick.com"].includes(url.hostname.toLowerCase())) return "";
  // Clips can use a channel URL with a clip query; keep those and VOD routes.
  if (url.searchParams.has("clip")) return "";
  const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
  const reserved = [
    "about", "advertise", "auth", "browse", "categories", "category", "clips",
    "community-guidelines", "dashboard", "dmca-policy", "download", "downloads",
    "following", "forgot-password", "login", "logout", "privacy-policy", "safety",
    "search", "security", "settings", "signup", "subscriptions", "terms-of-service"
  ];
  if (!match || reserved.includes(match[1].toLowerCase())) return "";
  return match[1].toLowerCase();
}

async function fetchKickLiveStream(channel, signal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = window.setTimeout(() => controller.abort(), SOURCE_RESOLVE_TIMEOUT_MS);
  try {
    const apiUrl = new URL(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`);
    // Also avoid an intermediary serving a previously cached channel response.
    apiUrl.searchParams.set("_", String(Date.now()));
    const response = await fetch(apiUrl.href, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error("Kick playback is restricted."), { code: "sourceRestricted" });
    }
    if (response.status === 404) throw Object.assign(new Error("Kick channel is offline."), { code: "sourceOffline" });
    if (!response.ok) throw Object.assign(new Error("Kick channel lookup failed."), {
      retryAfterMs: response.status === 429 ? 30000 : 0
    });
    const payload = await response.json();
    if (payload?.livestream === null || payload?.livestream?.is_live === false) {
      throw Object.assign(new Error("Kick channel is offline."), { code: "sourceOffline" });
    }
    if (!payload?.livestream || typeof payload.playback_url !== "string") {
      throw new Error("Invalid Kick channel response.");
    }
    const streamUrl = new URL(payload.playback_url);
    if (streamUrl.protocol !== "https:" || streamUrl.username || streamUrl.password || getPathExtension(streamUrl) !== "m3u8") {
      throw new Error("Invalid Kick stream URL.");
    }
    return {
      url: streamUrl.href,
      title: normalizePageTitle(payload.livestream.session_title) || `Kick · ${channel}`
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("Kick channel lookup timed out."), { code: "sourceTimeout" });
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

function isSoopHost(hostname) {
  return ["sooplive.com", "sooplive.co.kr", "afreecatv.com"].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

function getSoopLivePlayerUrl(url) {
  if (!["play.sooplive.com", "play.sooplive.co.kr", "play.afreecatv.com"].includes(url.hostname.toLowerCase())) return "";
  // SOOP publishes /<channel>[/<broadcast number>]/embed as the live player.
  // Keep the broadcast number, and leave VOD, chat and existing embeds alone.
  const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\/(\d+))?\/?$/);
  if (!match) return "";
  return `https://play.sooplive.com/${match[1]}${match[2] ? `/${match[2]}` : ""}/embed`;
}

function isBilibiliHost(hostname) {
  return hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");
}

function isYesLiveHost(hostname) {
  return hostname === "yes2049.com" || hostname.endsWith(".yes2049.com") || hostname === "yeslivetv.com" || hostname.endsWith(".yeslivetv.com") || hostname === "welife6.com" || hostname.endsWith(".welife6.com");
}

function isHuyaHost(hostname) {
  return hostname === "huya.com" || hostname.endsWith(".huya.com");
}

function getHuyaLivePlayerUrl(url) {
  // Only room pages use the stand-alone player. Keep categories, videos,
  // existing embeds, and other Huya services at their original URLs.
  if (!["huya.com", "www.huya.com", "m.huya.com"].includes(url.hostname.toLowerCase())) {
    return "";
  }

  const match = url.pathname.match(/^\/([a-zA-Z0-9]+)\/?$/);
  if (!match || ["g", "l", "u", "search", "download", "index", "replay"].includes(match[1].toLowerCase())) {
    return "";
  }

  // Huya's player resolves both numeric room IDs and private-host aliases.
  return `https://liveshare.huya.com/iframe/${match[1]}`;
}


// Official embed endpoints retain their original response security headers.
function isOfficialEmbed(url) {
  const host = url.hostname.toLowerCase();
  return ((host === "player.twitch.tv" || host === "clips.twitch.tv") && url.pathname.startsWith("/embed")) ||
    host === "player.twitch.tv" || host === "player.kick.com" ||
    (host === "liveshare.huya.com" && url.pathname.startsWith("/iframe/")) ||
    (host === "www.bilibili.com" && url.pathname.startsWith("/blackboard/live/")) ||
    (["play.sooplive.com", "play.sooplive.co.kr", "play.afreecatv.com"].includes(host) && /\/embed\/?$/.test(url.pathname));
}
