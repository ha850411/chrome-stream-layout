"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadDashboard(overrides = {}) {
  const context = vm.createContext({
    URL,
    structuredClone,
    AbortController,
    window: { setTimeout, clearTimeout },
    navigator: { language: "en" },
    location: {
      origin: "chrome-extension://test-extension",
      href: "chrome-extension://test-extension/dashboard.html"
    },
    document: {
      querySelector: () => ({}),
      querySelectorAll: () => [],
      body: {}
    },
    ResizeObserver: class {},
    // Hold UI initialization at its first storage read; exercise the real
    // routing functions without constructing a dashboard DOM or using network.
    chrome: { storage: { local: { get: () => new Promise(() => {}) } } },
    fetch: async (url) => {
      const host = new URL(url).hostname;
      if (host === "usher.ttvnw.net") return { ok: true, text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://stream.example/live.m3u8\n' };
      return { ok: true, json: async () => host === "kick.com"
        ? { livestream: { session_title: "Live match" }, playback_url: "https://stream.example/live.m3u8?token=original" }
        : host === "gql.twitch.tv"
          ? { data: { streamPlaybackAccessToken: { value: JSON.stringify({ authorization: { forbidden: false } }), signature: "test-signature" } } }
          : { data: { room_id: 22625025 } } };
    },
    ...overrides
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/twitch-source.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/dashboard.js"), "utf8"), context);
  return context;
}

const dashboard = loadDashboard();

for (const [input, expected] of [
  ["https://play.sooplive.com/afstar1", "https://play.sooplive.com/afstar1/embed"],
  ["play.sooplive.com/afstar1/", "https://play.sooplive.com/afstar1/embed"],
  ["http://play.sooplive.co.kr/afstar1/123456?from=share#live", "https://play.sooplive.com/afstar1/123456/embed"],
  ["https://play.afreecatv.com/some_channel/123456/", "https://play.sooplive.com/some_channel/123456/embed"]
]) {
  test(`SOOP live URLs use the official embedded player: ${input}`, async () => {
    const context = loadDashboard({ fetch: () => assert.fail("SOOP embeds must not require a lookup") });
    assert.equal((await context.resolveEmbed(input)).src, expected);
    assert.equal(context.getSourceLabel(input), "SOOP");
  });
}

for (const input of [
  "https://www.sooplive.com/", "https://play.sooplive.com/",
  "https://ch.sooplive.com/afstar1", "https://vod.sooplive.com/player/123456",
  "https://play.sooplive.com/afstar1/embed?mutePlay=false",
  "https://play.sooplive.com/afstar1/123456/embed",
  "https://play.sooplive.com/afstar1/chat", "https://play.sooplive.com/afstar1/123456/chat",
  "https://play.sooplive.com/afstar1%2Fembed", "https://play.sooplive.com.example.org/afstar1",
  "https://play.sooplive.com@other.example/afstar1"
]) {
  test(`SOOP non-live URLs remain unchanged: ${input}`, async () => {
    assert.equal((await dashboard.resolveEmbed(input)).src, new URL(input).href);
  });
}

for (const input of [
  "https://kick.com/starladder", "http://www.kick.com/starladder/",
  "kick.com/STARLADDER?ref=share#live"
]) {
  test(`Kick channel resolves to an IVS stream: ${input}`, async () => {
    const result = await dashboard.resolveEmbed(input);
    assert.equal(result.src, "https://stream.example/live.m3u8?token=original");
    assert.equal(result.livePlayer, true);
    assert.equal(result.muted, true);
    assert.equal(result.autoplay, true);
    assert.equal(result.title, "Live match");
    assert.equal(dashboard.getSourceLabel(input), "Kick");
  });
}

test("Kick preserves explicit playback preferences and supports channel punctuation", async () => {
  const result = await dashboard.resolveEmbed("https://kick.com/some_channel-1?autoplay=false&muted=false");
  assert.equal(dashboard.getKickLiveChannel(new URL("https://kick.com/some_channel-1")), "some_channel-1");
  assert.equal(result.autoplay, false);
  assert.equal(result.muted, false);
});

test("Kick refresh fetches a new URL each time without changing signed stream parameters", async () => {
  let calls = 0;
  const context = loadDashboard({ fetch: async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin + url.pathname, "https://kick.com/api/v2/channels/starladder");
    assert.ok(url.searchParams.get("_"));
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    const sequence = ++calls;
    return { ok: true, json: async () => ({ livestream: { session_title: `Match ${sequence}` },
      playback_url: `https://stream.example/live.m3u8?token=${sequence}&signature=a%2Fb%3D` }) };
  } });
  const first = await context.resolveEmbed("https://kick.com/starladder");
  const second = await context.resolveEmbed("https://kick.com/starladder");
  assert.equal(first.src, "https://stream.example/live.m3u8?token=1&signature=a%2Fb%3D");
  assert.equal(second.src, "https://stream.example/live.m3u8?token=2&signature=a%2Fb%3D");
  assert.equal(second.title, "Match 2");
});

test("Kick distinguishes offline channels from lookup failures", async () => {
  for (const livestream of [null, { is_live: false }]) {
    const context = loadDashboard({ fetch: async () => ({ ok: true, json: async () => ({ livestream }) }) });
    await assert.rejects(context.resolveEmbed("https://kick.com/starladder"), (e) => e.code === "sourceOffline");
  }
  const context = loadDashboard({ fetch: async () => ({ ok: false }) });
  await assert.rejects(context.resolveEmbed("https://kick.com/starladder"), /lookup failed/);
});

test("Kick rejects malformed API responses and unsafe playback URLs", async () => {
  for (const payload of [null, {}, { livestream: {} }, ...[
    "javascript:alert(1)", "http://stream.example/live.m3u8", "https://stream.example/login.html",
    "https://user:password@stream.example/live.m3u8"
  ].map((playback_url) => ({ livestream: {}, playback_url }))]) {
    const context = loadDashboard({ fetch: async () => ({ ok: true, json: async () => payload }) });
    await assert.rejects(context.resolveEmbed("https://kick.com/starladder"));
  }
});

test("Kick lookup times out and a subsequent refresh can recover", async () => {
  let calls = 0;
  const context = loadDashboard({
    window: { setTimeout: (fn) => setTimeout(fn, 5), clearTimeout },
    fetch: async (_url, { signal }) => {
      if (++calls > 1) return { ok: true, json: async () => ({ livestream: {}, playback_url: "https://stream.example/fresh.m3u8" }) };
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
  });
  await assert.rejects(context.resolveEmbed("https://kick.com/starladder"), (e) => e.code === "sourceTimeout");
  assert.equal((await context.resolveEmbed("https://kick.com/starladder")).src, "https://stream.example/fresh.m3u8");
});

test("Replacing a Kick lookup aborts the pending network request", async () => {
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  let aborted = false;
  const context = loadDashboard({ fetch: async (_url, { signal }) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      aborted = true; reject(new Error("aborted"));
    }));
  } });
  const controller = new AbortController();
  const request = context.resolveEmbed("https://kick.com/starladder", controller.signal);
  await pending; controller.abort();
  await assert.rejects(request);
  assert.equal(aborted, true);
});

for (const input of [
  "https://kick.com/", "https://kick.com/categories", "https://kick.com/search?query=cs2",
  "https://kick.com/terms-of-service", "https://kick.com/starladder/videos/123456",
  "https://kick.com/starladder?clip=clip_123", "https://kick.com/starladder/clips",
  "https://player.kick.com/starladder?muted=false", "https://help.kick.com/article",
  "https://kick.com/starladder%2Fvideos", "https://kick.com.example.org/starladder",
  "https://kick.com@other.example/starladder"
]) {
  test(`Kick non-live URLs remain unchanged: ${input}`, async () => {
    assert.equal((await dashboard.resolveEmbed(input)).src, new URL(input).href);
  });
}

for (const input of [
  "https://www.twitch.tv/roger9527",
  "http://twitch.tv/roger9527/",
  "www.twitch.tv/roger9527",
  "https://m.twitch.tv/ROGER9527?tt_content=channel#player"
]) {
  test(`Twitch live channel resolves a signed source for the local player: ${input}`, async () => {
    const context = loadDashboard();
    const result = await context.resolveEmbed(input);
    const url = new URL(result.src);
    assert.equal(result.ok, true);
    assert.equal(url.origin, "https://usher.ttvnw.net");
    assert.equal(url.pathname, "/api/v2/channel/hls/roger9527.m3u8");
    assert.equal(url.searchParams.get("sig"), "test-signature");
    assert.equal(result.livePlayer, true);
    assert.equal(result.autoplay, true);
    assert.equal(result.muted, true);
    assert.equal(result.title, "Twitch · roger9527");
    assert.equal(url.searchParams.has("tt_content"), false);
    assert.equal(result.fallbackSrc, undefined);
    assert.equal(context.isLocalLiveSource(new URL(input.startsWith('www.') ? `https://${input}` : input)), true);
  });
}

test("Twitch respects explicit playback options", async () => {
  const context = loadDashboard();
  const result = await context.resolveEmbed("https://www.twitch.tv/some_channel?autoplay=false&muted=false");
  const url = new URL(result.src);
  assert.equal(url.pathname, "/api/v2/channel/hls/some_channel.m3u8");
  assert.equal(result.autoplay, false);
  assert.equal(result.muted, false);
});

for (const input of [
  "https://www.twitch.tv/",
  "https://www.twitch.tv/directory",
  "https://www.twitch.tv/DIRECTORY/",
  "https://www.twitch.tv/downloads",
  "https://www.twitch.tv/search?term=roger9527",
  "https://www.twitch.tv/settings",
  "https://www.twitch.tv/videos/123456789?t=1h2m3s",
  "https://www.twitch.tv/roger9527/videos",
  "https://www.twitch.tv/roger9527/clip/SomeClip",
  "https://www.twitch.tv/roger9527?clip=SomeClip",
  "https://www.twitch.tv/popout/roger9527/chat",
  "https://clips.twitch.tv/SomeClip",
  "https://player.twitch.tv/?channel=roger9527&parent=example.org&muted=false",
  "https://www.twitch.tv/roger%2F9527",
  "https://www.twitch.tv.example.org/roger9527",
  "https://twitch.tv@other.example/roger9527"
]) {
  test(`Twitch non-channel URLs are preserved: ${input}`, async () => {
    const context = loadDashboard({ fetch: () => assert.fail("Non-live Twitch URLs must not query playback APIs") });
    assert.equal((await context.resolveEmbed(input)).src, new URL(input).href);
    assert.equal(context.isLocalLiveSource(new URL(input)), false);
  });
}

for (const [input, room] of [
  ["https://www.huya.com/660000", "660000"],
  ["http://huya.com/660000/", "660000"],
  ["www.huya.com/660000", "660000"],
  ["https://m.huya.com/660000?shareid=123#player", "660000"],
  ["https://www.huya.com/lpl", "lpl"],
  ["https://www.huya.com/Uzi?from=search", "Uzi"]
]) {
  test(`Huya room uses its stand-alone player: ${input}`, async () => {
    const result = await dashboard.resolveEmbed(input);
    assert.equal(result.ok, true);
    assert.equal(result.src, `https://liveshare.huya.com/iframe/${room}`);
    assert.equal(result.fixedViewport, undefined);
  });
}

for (const input of [
  "https://www.huya.com/",
  "https://www.huya.com/g",
  "https://www.huya.com/g/lol",
  "https://www.huya.com/l",
  "https://www.huya.com/download/",
  "https://www.huya.com/search?hsk=lpl",
  "https://www.huya.com/660000/replay",
  "https://www.huya.com/room%2F660000",
  "https://v.huya.com/play/123.html",
  "https://hd.huya.com/event",
  "https://liveshare.huya.com/iframe/660000?mute=1",
  "https://www.huya.com.example.org/660000",
  "https://huya.com@other.example/660000"
]) {
  test(`Non-room URL is preserved: ${input}`, async () => {
    const result = await dashboard.resolveEmbed(input);
    assert.equal(result.ok, true);
    assert.equal(result.src, new URL(input).href);
  });
}

test("YouTube embed and fallback are preserved", async () => {
  const input = "https://youtu.be/abcdefghijk?t=1m30s";
  const result = await dashboard.resolveEmbed(input);
  const url = new URL(result.src);
  assert.equal(url.hostname, "www.youtube.com");
  assert.equal(url.pathname, "/embed/abcdefghijk");
  assert.equal(url.searchParams.get("start"), "90");
  assert.equal(result.fallbackSrc, input);
});

test("Bilibili short room IDs still resolve to its live player", async () => {
  const result = await dashboard.resolveEmbed("https://live.bilibili.com/6");
  const url = new URL(result.src);
  assert.equal(url.pathname, "/blackboard/live/live-activity-player.html");
  assert.equal(url.searchParams.get("cid"), "22625025");
  assert.equal(url.searchParams.get("danmaku"), "1");
  assert.equal(result.bilibiliRoomId, "22625025");
});

test("YesLive retains its fixed viewport", async () => {
  const input = "https://yeslivetv.com/channel/";
  const result = await dashboard.resolveEmbed(input);
  assert.equal(result.src, input);
  assert.equal(result.fixedViewport.width, 1920);
  assert.equal(result.fixedViewport.height, 1080);
});

for (const input of ["javascript:alert(1)", "file:///tmp/video.mp4", "data:text/html,test"]) {
  test(`Unsupported scheme is rejected: ${input}`, async () => {
    assert.equal((await dashboard.resolveEmbed(input)).ok, false);
  });
}

for (const input of ["https://example.org/%", "https://example.org/%E0%A4", "https://example.org/100%.mp4"]) {
  test(`Malformed escapes do not interrupt source labels: ${input}`, () => {
    assert.doesNotThrow(() => dashboard.getSourceLabel(input));
  });
}

test("A percent-encoded extension still produces a media label", () => {
  assert.equal(dashboard.getSourceLabel("https://example.org/video%2Emp4"), "Video .mp4");
});

test("Concurrent Bilibili lookups share a successful request", async () => {
  let calls = 0;
  const context = loadDashboard({ fetch: async () => {
    calls++;
    return { ok: true, json: async () => ({ code: 0, data: { room_id: 123456 } }) };
  } });
  assert.deepEqual(await Promise.all([context.resolveBilibiliLiveRoomId("6"), context.resolveBilibiliLiveRoomId("6")]), ["123456", "123456"]);
  assert.equal(await context.resolveBilibiliLiveRoomId("6"), "123456");
  assert.equal(calls, 1);
});

test("Failed Bilibili requests can be retried instead of caching the short ID", async () => {
  let calls = 0;
  const context = loadDashboard({ fetch: async () => ++calls === 1
    ? { ok: false }
    : { ok: true, json: async () => ({ data: { room_id: 123456 } }) }
  });
  await assert.rejects(context.resolveBilibiliLiveRoomId("6"));
  assert.equal(await context.resolveBilibiliLiveRoomId("6"), "123456");
  assert.equal(calls, 2);
});

test("Bilibili API failures and invalid room IDs are not treated as success", async () => {
  for (const payload of [{ code: -400 }, { code: 1, data: { room_id: 123 } }, { data: { room_id: 0 } }, {}]) {
    const context = loadDashboard({ fetch: async () => ({ ok: true, json: async () => payload }) });
    await assert.rejects(context.resolveBilibiliLiveRoomId("6"));
  }
});

test("A lookup timeout aborts the request and allows another attempt", async () => {
  let calls = 0;
  let aborted = 0;
  const context = loadDashboard({
    window: { setTimeout: (fn) => setTimeout(fn, 5), clearTimeout },
    fetch: async (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        aborted++;
        reject(new Error("aborted"));
      }, { once: true }));
    }
  });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(context.resolveBilibiliLiveRoomId("6"), (error) => error.code === "sourceTimeout");
  }
  assert.equal(calls, 2);
  assert.equal(aborted, 2);
});

test("Bilibili titles use room metadata and normalize whitespace", async () => {
  const context = loadDashboard({ fetch: async (input, options) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/room/v1/Room/get_info");
    assert.equal(url.searchParams.get("room_id"), "7734200");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ code: 0, data: { room_id: 7734200, title: "  【直播】WE\n vs   JDG  " } }) };
  } });
  assert.equal(await context.fetchBilibiliLiveTitle("7734200"), "【直播】WE vs JDG");
});

test("Bilibili metadata rejects failures, missing titles and titles for another room", async () => {
  for (const payload of [
    { code: -400 }, {},
    { code: 0, data: { room_id: 7734200, title: "  " } },
    { code: 0, data: { room_id: 7734200, title: { invalid: true } } },
    { code: 0, data: { room_id: 35, title: "Wrong room" } }
  ]) {
    const context = loadDashboard({ fetch: async () => ({ ok: true, json: async () => payload }) });
    await assert.rejects(context.fetchBilibiliLiveTitle("7734200"));
  }
  const context = loadDashboard({ fetch: async () => ({ ok: false }) });
  await assert.rejects(context.fetchBilibiliLiveTitle("7734200"));
});

test("Bilibili title lookups abort on timeout and fetch a fresh title on retry", async () => {
  let calls = 0;
  let aborted = false;
  const context = loadDashboard({
    window: { setTimeout: (fn) => setTimeout(fn, 5), clearTimeout },
    fetch: async (_url, { signal }) => {
      if (++calls > 1) return { ok: true, json: async () => ({ code: 0, data: { room_id: 7734200, title: `Title ${calls}` } }) };
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      }, { once: true }));
    }
  });
  await assert.rejects(context.fetchBilibiliLiveTitle("7734200"));
  assert.equal(aborted, true);
  assert.equal(await context.fetchBilibiliLiveTitle("7734200"), "Title 2");
  assert.equal(await context.fetchBilibiliLiveTitle("7734200"), "Title 3");
});
