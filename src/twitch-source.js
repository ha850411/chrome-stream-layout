"use strict";

function getTwitchLiveChannel(url) {
  if (!url || !["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(url.hostname.toLowerCase())) return "";
  if (url.searchParams.has("clip")) return "";
  const match = url.pathname.match(/^\/([a-zA-Z0-9_]+)\/?$/);
  const reserved = [
    "activate", "bits", "collections", "communities", "creatorcamp", "dashboard",
    "directory", "discover", "downloads", "drops", "embed", "following", "friends",
    "inventory", "jobs", "login", "logout", "messages", "moderator", "p", "payments",
    "popout", "prime", "products", "search", "settings", "signup", "store",
    "subscriptions", "team", "teams", "turbo", "videos", "wallet"
  ];
  return match && !reserved.includes(match[1].toLowerCase()) ? match[1].toLowerCase() : "";
}

async function fetchTwitchLiveStream(channel, signal) {
  if (!/^[a-z0-9_]+$/.test(channel)) throw new Error("Invalid Twitch channel.");
  const cancelled = () => Object.assign(new Error("Twitch lookup cancelled."), { name: "AbortError" });
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; cancel(); }, SOURCE_RESOLVE_TIMEOUT_MS);
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const checkResponse = (response, playlist = false) => {
    if (response.status === 401 || response.status === 403) throw fail("sourceRestricted", "Twitch playback is restricted.");
    if (playlist && response.status === 404) throw fail("sourceOffline", "Twitch channel is offline.");
    if (!response.ok) {
      const error = new Error("Twitch stream lookup failed.");
      if (response.status === 429 || response.status === 503) {
        const value = response.headers?.get("Retry-After");
        const seconds = value && /^\d+$/.test(value) ? Number(value) : 0;
        const dateDelay = value && !seconds ? Date.parse(value) - Date.now() : 0;
        error.retryAfterMs = Math.min(300000, Math.max(response.status === 429 ? 30000 : 0,
          seconds * 1000, Number.isFinite(dateDelay) ? dateDelay : 0));
      }
      throw error;
    }
  };
  try {
    // Twitch's non-public playback interface, also used by Streamlink. Keep
    // it isolated from the player; never persist or log signed playback URLs.
    // https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/twitch.py
    const response = await fetch("https://gql.twitch.tv/gql", {
      method: "POST", credentials: "omit", cache: "no-store", signal: controller.signal,
      headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "PlaybackAccessToken",
        extensions: { persistedQuery: { version: 1, sha256Hash: "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9" } },
        variables: { isLive: true, login: channel, isVod: false, vodID: "", playerType: "embed", platform: "site" }
      })
    });
    checkResponse(response);
    const payload = await response.json();
    if (payload?.errors?.length) {
      const restricted = payload.errors.some((error) =>
        /integrity|unauthori[sz]ed|forbidden|access denied/i.test(String(error?.message || "")) ||
        ["UNAUTHORIZED", "FORBIDDEN"].includes(error?.extensions?.code));
      if (restricted) throw fail("sourceRestricted", "Twitch playback verification required.");
      throw new Error("Twitch playback token unavailable.");
    }
    const token = payload?.data?.streamPlaybackAccessToken;
    if (token === null) throw fail("sourceOffline", "Twitch channel is unavailable.");
    if (typeof token?.value !== "string" || !token.value || typeof token.signature !== "string" || !token.signature) {
      throw new Error("Invalid Twitch playback token.");
    }
    const access = JSON.parse(token.value);
    if (!access || typeof access !== "object" || Array.isArray(access)) throw new Error("Invalid Twitch token data.");
    if (access.authorization?.forbidden === true) throw fail("sourceRestricted", "Twitch playback is restricted.");
    if (Number.isFinite(access.expires) && access.expires * 1000 <= Date.now()) throw new Error("Expired Twitch playback token.");
    if (controller.signal.aborted) throw cancelled();
    const url = new URL(`https://usher.ttvnw.net/api/v2/channel/hls/${channel}.m3u8`);
    for (const [name, value] of Object.entries({
      token: token.value, sig: token.signature, allow_source: "true", allow_audio_only: "true",
      playlist_include_framerate: "true", supported_codecs: "h264", player: "twitchweb", platform: "web"
    })) url.searchParams.set(name, value);
    // Validate availability before handing the URL to IVS, so an offline or
    // restricted channel gets an actionable status instead of a media error.
    const master = await fetch(url.href, { credentials: "omit", cache: "no-store", signal: controller.signal });
    checkResponse(master, true);
    const playlist = (await master.text()).trimStart();
    if (!playlist.startsWith("#EXTM3U") || !/^#EXT-X-STREAM-INF:/m.test(playlist)) throw new Error("Invalid Twitch playlist.");
    if (controller.signal.aborted) throw cancelled();
    return { url: url.href, title: `Twitch · ${channel}` };
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (timedOut) throw fail("sourceTimeout", "Twitch stream lookup timed out.");
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
