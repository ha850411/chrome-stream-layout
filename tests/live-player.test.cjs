"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup(supported = true) {
  const events = new Map();
  const calls = [];
  const timers = new Map();
  let time = 0, nextTimer = 0;
  const player = {
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name); },
    getQualities() { return [{ height: 360, framerate: 30 }, { height: 1080, framerate: 60 }, { height: 720, framerate: 60 }]; }
  };
  for (const method of ["attachHTMLVideoElement", "setLiveLowLatencyEnabled", "setRebufferToLive", "setAutoMaxVideoSize", "setQuality", "setAutoQualityMode", "setMuted", "setVolume", "setAutoplay", "load", "play", "delete"]) {
    player[method] = (...args) => calls.push([method, ...args]);
  }
  const sdk = { isPlayerSupported: supported, create(config) { calls.push(["create", config]); return player; },
    PlayerState: { READY: "ready", PLAYING: "playing", BUFFERING: "buffering", ENDED: "ended" },
    PlayerEventType: { ERROR: "error", PLAYBACK_BLOCKED: "blocked" } };
  const context = vm.createContext({ IVSPlayer: sdk, chrome: { runtime: { getURL: (s) => `chrome-extension://test/${s}` } },
    window: {
      setTimeout(fn, delay) { timers.set(++nextTimer, { fn, at: time + delay }); return nextTimer; },
      clearTimeout(id) { timers.delete(id); }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/live-engine.js"), "utf8"), context);
  const notifications = [];
  const create = () => context.createLiveEngine({}, {
    qualities: (options, selected) => notifications.push({ options, selected }),
    status: (status) => notifications.push(status), error: (error) => notifications.push(error)
  });
  const advance = (duration) => {
    const target = time + duration;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = target;
  };
  return { create, events, calls, notifications, context, timers, advance };
}

test("IVS reuses one instance across fresh signed URLs and preserves volume/mute changes", () => {
  const r = setup(); const engine = r.create();
  for (let i = 0; i < 8; i++) {
    engine.load({ src: `https://stream.example/live.m3u8?sig=${i}`, muted: true, volume: 0.4 });
    r.events.get("ready")();
  }
  assert.equal(r.calls.filter(([name]) => name === "create").length, 1);
  assert.equal(r.calls.filter(([name]) => name === "load").length, 8);
  assert.equal(r.calls.filter(([name]) => name === "setMuted").length, 1);
  assert.deepEqual(r.calls.filter(([name]) => name === "setVolume"), [["setVolume", 0.4]]);
  assert.ok(r.calls.some(([name, enabled]) => name === "setLiveLowLatencyEnabled" && enabled));
  assert.ok(r.calls.some(([name, enabled]) => name === "setRebufferToLive" && enabled));
  assert.match(r.calls[0][1].wasmWorker, /^chrome-extension:\/\/test\//);
});

test("Manual quality uses stream qualities and Auto is restored explicitly", () => {
  const r = setup(); const engine = r.create();
  engine.load({ src: "https://stream.example/live.m3u8", quality: "1080p60" });
  r.events.get("ready")();
  assert.deepEqual(Array.from(r.notifications[0].options, (q) => q.value), ["1080p60", "720p60", "360p30"]);
  assert.equal(r.notifications[0].selected, "1080p60");
  assert.equal(engine.setQuality("360p30"), "360p30");
  assert.equal(r.calls.at(-1)[0], "setQuality");
  assert.equal(r.calls.at(-1)[1].height, 360);
  assert.equal(r.calls.at(-1)[2], true);
  engine.setQuality("auto");
  assert.deepEqual(r.calls.at(-1), ["setAutoQualityMode", true]);
});

test("Unavailable quality falls back to Auto; explicit no-autoplay does not start playback", () => {
  const r = setup(); const engine = r.create();
  engine.load({ src: "https://stream.example/live.m3u8", quality: "1440p60", autoplay: false, muted: false });
  r.events.get("ready")();
  assert.equal(r.notifications[0].selected, "auto");
  assert.equal(r.notifications[1], "sourcePaused");
  assert.equal(r.calls.some(([name]) => name === "play"), false);
  assert.ok(r.calls.some(([name, muted]) => name === "setMuted" && muted === false));
  engine.resize(640, 360);
  assert.deepEqual(r.calls.at(-1), ["setAutoMaxVideoSize", 640, 360]);
});

test("Disposal is idempotent and detached SDK events cannot update a removed pane", () => {
  const r = setup(); const engine = r.create();
  const late = r.events.get("ready");
  engine.destroy(); engine.destroy(); late();
  engine.load({ src: "https://stream.example/old.m3u8" });
  engine.setQuality("auto");
  assert.equal(r.events.size, 0);
  assert.equal(r.calls.filter(([name]) => name === "delete").length, 1);
  assert.deepEqual(r.notifications, []);
});

test("Blocked autoplay remains playable; terminal errors do not create retry loops", () => {
  const r = setup(); r.create();
  r.events.get("blocked")(); r.events.get("error")();
  assert.equal(r.notifications[0], "sourcePaused");
  assert.equal(r.notifications[1].kind, "media");
  assert.equal(r.calls.some(([name]) => name === "load"), false);
  assert.throws(() => setup(false).create(), /unavailable/);
});

test("SDK errors preserve actionable categories without exposing tokens or signed URLs", () => {
  const r = setup(); r.create();
  r.events.get("error")({ type: "ErrorAuthorization", code: 403, source: "MasterPlaylist", message: "https://example.com/?token=secret" });
  assert.deepEqual(JSON.parse(JSON.stringify(r.notifications[0])), {
    kind: "authorization", type: "ErrorAuthorization", code: 403, source: "MasterPlaylist", retryable: true, retryAfterMs: 0
  });
  assert.equal(JSON.stringify(r.notifications).includes("secret"), false);
  assert.equal(r.context.describeLiveError({ type: "ErrorNotSupported" }).retryable, false);
  assert.equal(r.context.describeLiveError({ type: "ErrorNetwork", code: 429 }).retryAfterMs, 30000);
  r.events.get("ended")(); assert.equal(r.notifications.at(-1).kind, "ended");
});

test("Autoplay starts through the SDK without a second play request on READY", () => {
  const r = setup(); const engine = r.create();
  engine.load({ src: "https://stream.example/live.m3u8" });
  r.events.get("ready")();
  assert.deepEqual(r.calls.filter(([name]) => name === "setAutoplay"), [["setAutoplay", true]]);
  assert.equal(r.calls.filter(([name]) => name === "play").length, 0);
});

test("Continuous pane resizing coalesces worker updates and applies the final dimensions", () => {
  const r = setup(); const engine = r.create();
  engine.resize(640, 360);
  const caps = () => r.calls.filter(([name]) => name === "setAutoMaxVideoSize");
  assert.deepEqual(caps(), [["setAutoMaxVideoSize", 640, 360]]);
  for (let i = 1; i <= 120; i++) {
    engine.resize(640 + i, 360 + i);
    r.advance(16);
  }
  r.advance(250);
  assert.ok(caps().length <= 9, `expected at most 9 updates, got ${caps().length}`);
  assert.deepEqual(caps().at(-1), ["setAutoMaxVideoSize", 760, 480]);
  assert.equal(r.timers.size, 0);
});

test("Unchanged, subpixel-equivalent and invalid dimensions do not wake the worker", () => {
  const r = setup(); const engine = r.create();
  engine.resize(639.2, 359.2);
  for (let i = 0; i < 50; i++) engine.resize(639.8, 359.8);
  for (const [width, height] of [[0, 0], [-1, 360], [NaN, 360], [640, Infinity]]) engine.resize(width, height);
  r.advance(1000);
  assert.deepEqual(r.calls.filter(([name]) => name === "setAutoMaxVideoSize"), [["setAutoMaxVideoSize", 640, 360]]);
  assert.equal(r.timers.size, 0);
});

test("A new source immediately receives the latest cap; resizing preserves manual quality", () => {
  const r = setup(); const engine = r.create();
  engine.resize(640, 360);
  engine.load({ src: "https://stream.example/first.m3u8", quality: "1080p60" });
  r.events.get("ready")();
  engine.resize(1280, 720);
  engine.load({ src: "https://stream.example/second.m3u8", quality: "1080p60" });
  r.events.get("ready")();
  const caps = () => r.calls.filter(([name]) => name === "setAutoMaxVideoSize");
  assert.deepEqual(caps().at(-1), ["setAutoMaxVideoSize", 1280, 720]);
  const count = caps().length;
  r.advance(1000);
  assert.equal(caps().length, count);
  assert.equal(r.calls.filter(([name]) => name === "setQuality").length, 2);
  assert.equal(r.calls.some(([name]) => name === "setAutoQualityMode"), false);
  engine.load({ src: "https://stream.example/third.m3u8" });
  r.events.get("ready")();
  assert.equal(caps().length, count + 1, "each source must receive its cap even at the same size");
});

test("Removing a player cancels pending resize work and ignores a detached callback", () => {
  const r = setup(); const engine = r.create();
  engine.resize(640, 360);
  engine.resize(1280, 720);
  assert.equal(r.timers.size, 1);
  const late = [...r.timers.values()][0].fn;
  engine.destroy(); late(); engine.resize(1920, 1080); r.advance(1000);
  assert.equal(r.timers.size, 0);
  assert.deepEqual(r.calls.filter(([name]) => name === "setAutoMaxVideoSize"), [["setAutoMaxVideoSize", 640, 360]]);
});
