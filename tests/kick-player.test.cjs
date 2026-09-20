"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup(supported = true) {
  const events = new Map();
  const calls = [];
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
  const context = vm.createContext({ IVSPlayer: sdk, chrome: { runtime: { getURL: (s) => `chrome-extension://test/${s}` } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/kick-engine.js"), "utf8"), context);
  const notifications = [];
  const create = () => context.createKickEngine({}, {
    qualities: (options, selected) => notifications.push({ options, selected }),
    status: (status) => notifications.push(status), error: () => notifications.push("error")
  });
  return { create, events, calls, notifications };
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
  assert.deepEqual(r.notifications, ["sourcePaused", "error"]);
  assert.equal(r.calls.some(([name]) => name === "load"), false);
  assert.throws(() => setup(false).create(), /unavailable/);
});
