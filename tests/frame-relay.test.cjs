"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
function rig(initial = []) {
  let now = 0, nextTimer = 1, scans = 0;
  const timers = new Map(), observers = [], handlers = {}, messages = [];
  const html = { parentElement: null }, body = { parentElement: html }, head = { parentElement: html };
  let videos = initial.map((value) => ({ isConnected: true, paused: true, readyState: 4, parentElement: body,
    getBoundingClientRect: () => ({ width: 640, height: 360 }), ...value }));
  const listen = (type, handler) => { (handlers[type] ||= []).push(handler); };
  const document = { hidden: false, body, head, documentElement: html, title: "Fixture", referrer: "chrome-extension://test/dashboard.html",
    querySelector: () => null, querySelectorAll: () => { scans++; return videos; }, addEventListener: listen };
  const window = { top: { postMessage: (value) => messages.push(value) }, addEventListener: listen,
    setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, time: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id) };
  const context = vm.createContext({ document, window, location: { hostname: "fixture.example" }, chrome: { runtime: { id: "test" } },
    MutationObserver: class { constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this); }
      observe(node, options) { this.nodes.push({ node, options }); } disconnect() { this.nodes = []; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/frame-relay.js"), "utf8"), context);
  const tick = (duration) => {
    const end = now + duration;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
      if (!next) break;
      const [id, timer] = next; now = timer.time; timers.delete(id); timer.fn();
    }
    now = end;
  };
  return { body, document, window, observers, messages, timers, scans: () => scans, tick,
    event: (type, event = {}) => handlers[type]?.forEach((handler) => handler(event)),
    videos: () => videos,
    replace: (value) => { videos.forEach((video) => { video.isConnected = false; }); videos = value.map((v) => ({ isConnected: true, paused: true, readyState: 4, parentElement: body, getBoundingClientRect: () => ({ width: 640, height: 360 }), ...v })); },
    mutate: (target = body) => {
      observers.forEach((observer) => {
        if (observer.nodes.some(({ node, options }) => node === target || (options.subtree && node === body))) observer.callback([{ target, addedNodes: [], removedNodes: [] }]);
      });
    }
  };
}

test("Chat mutations do not scan a page with an established video", () => {
  const r = rig([{}]);
  const before = r.scans();
  for (let i = 0; i < 1000; i++) r.mutate({ parentElement: r.body });
  r.tick(500);
  assert.equal(r.scans(), before);
  assert.equal(r.messages.at(-1).status, "sourcePaused");
});

test("Video discovery coalesces mutations and catches paused replacement and removal", () => {
  const r = rig();
  const before = r.scans();
  for (let i = 0; i < 1000; i++) r.mutate();
  r.replace([{}]); r.tick(250);
  assert.equal(r.scans() - before, 1);
  assert.equal(r.messages.at(-1).status, "sourcePaused");
  r.replace([{ paused: false }]); r.mutate(); r.tick(250);
  assert.equal(r.messages.at(-1).status, "sourcePlaying");
  r.replace([]); r.mutate(); r.tick(250);
  assert.equal(r.messages.at(-1).status, "sourcePageLoaded");
});

test("Broad discovery stops after 30 seconds, while a later paused player is still found", () => {
  const r = rig(); r.tick(30000);
  assert.equal(r.observers.some((observer) => observer.nodes.some(({ node, options }) => node === r.body && options.subtree)), false);
  r.replace([{}]); r.tick(10000);
  assert.equal(r.messages.at(-1).status, "sourcePaused");
});

test("Hidden pages suspend every observer and timer, and resume with current playback", () => {
  const r = rig([{}]);
  r.document.hidden = true; r.event("visibilitychange");
  const before = r.scans();
  assert.equal(r.observers.some((observer) => observer.nodes.length), false);
  assert.equal(r.timers.size, 0);
  r.event("playing", { target: r.videos()[0] }); r.tick(60000);
  assert.equal(r.scans(), before);
  r.replace([{ paused: false }]); r.document.hidden = false; r.event("visibilitychange");
  assert.equal(r.messages.at(-1).status, "sourcePlaying");
  r.event("pagehide");
  assert.equal(r.timers.size, 0);
});

test("The largest player wins over a preview and media events reuse the cached selection", () => {
  const r = rig([{ paused: false }, { getBoundingClientRect: () => ({ width: 50, height: 50 }) }]);
  assert.equal(r.messages.at(-1).status, "sourcePlaying");
  const before = r.scans();
  r.event("waiting", { target: r.videos()[0], type: "waiting" });
  assert.equal(r.scans(), before);
  assert.equal(r.messages.at(-1).status, "sourceBuffering");
  r.event("pause", { target: r.videos()[1] });
  assert.equal(r.messages.at(-1).status, "sourceBuffering");
});
