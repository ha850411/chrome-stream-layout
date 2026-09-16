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
    fetch: async () => ({ ok: true, json: async () => ({ data: { room_id: 22625025 } }) }),
    ...overrides
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/dashboard.js"), "utf8"), context);
  return context;
}

const dashboard = loadDashboard();

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
