"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHelper() {
  const timers = new Map();
  const observers = [];
  const events = {};
  let id = 0;
  const window = {
    setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    clearTimeout: (timer) => timers.delete(timer),
    addEventListener: (name, fn) => { events[name] = fn; }
  };
  window.top = window;
  const root = { parentElement: null };
  const document = {
    documentElement: root, hidden: false,
    addEventListener: (name, fn) => { events[name] = fn; }
  };
  const context = vm.createContext({
    window, document, location: {}, chrome: { runtime: { id: "test-extension" } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
      observe(node, options) { this.targets.push({ node, options }); }
      disconnect() { this.targets = []; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/frame-helper.js"), "utf8"), context);
  const tick = (delay) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `expected a ${delay}ms timer`);
    timers.delete(entry[0]); entry[1].fn();
  };
  return { context, root, document, events, observers, timers, tick };
}

test("An ordinary top-level page installs no player observers", () => {
  const rig = loadHelper();
  assert.equal(rig.observers.length, 0);
  assert.equal(rig.timers.size, 0);
});

test("A discovered player observes only its ancestors' direct children", () => {
  const rig = loadHelper();
  const parent = { parentElement: rig.root };
  const player = { parentElement: parent };
  rig.context.watchPlayerLifecycle(() => player, () => {});
  const targets = rig.observers[0].targets;
  assert.deepEqual(targets.map((t) => t.node), [parent, rig.root]);
  assert.ok(targets.every((t) => t.options.childList && !t.options.subtree));
  assert.equal(rig.timers.size, 0);
});

test("Whole-page discovery is throttled and stops after its deadline", () => {
  const rig = loadHelper();
  let checks = 0;
  rig.context.watchPlayerLifecycle(() => null, () => checks++);
  const observer = rig.observers[0];
  for (let i = 0; i < 100; i++) observer.callback();
  assert.equal([...rig.timers.values()].filter((t) => t.delay === 250).length, 1);
  rig.tick(250);
  assert.equal(checks, 1);
  rig.tick(30000);
  assert.equal(observer.targets.length, 0);
});

test("Replacing a player rebinds observation and hidden pages suspend it", () => {
  const rig = loadHelper();
  let player = { parentElement: rig.root };
  const refresh = rig.context.watchPlayerLifecycle(() => player, () => {});
  const observer = rig.observers[0];
  player = null;
  observer.callback(); rig.tick(250);
  assert.equal(observer.targets[0].options.subtree, true);
  const newParent = { parentElement: rig.root };
  player = { parentElement: newParent };
  refresh();
  assert.equal(observer.targets[0].node, newParent);
  assert.equal(rig.timers.size, 0);
  rig.document.hidden = true;
  rig.events.visibilitychange();
  assert.equal(observer.targets.length, 0);
  rig.document.hidden = false;
  rig.events.visibilitychange();
  assert.equal(observer.targets[0].node, newParent);
  rig.events.pagehide();
  assert.equal(observer.targets.length, 0);
  rig.events.pageshow();
  assert.equal(observer.targets[0].node, newParent);
});
