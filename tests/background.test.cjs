"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const BASE = "chrome-extension://test-extension/";

async function loadBackground(initialTabs = [], initialRules = []) {
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const rig = { tabs: initialTabs, rules: initialRules, writes: [], fail: false };
  const context = vm.createContext({
    URL,
    console: { warn() {} },
    chrome: {
      runtime: { id: "test-extension", getURL: (p) => BASE + p, onMessage: event("message") },
      action: { onClicked: event("click") },
      tabs: {
        query: async () => {
          const snapshot = structuredClone(rig.tabs);
          if (rig.beforeQueryReturns) await rig.beforeQueryReturns();
          return snapshot;
        },
        onUpdated: event("updated"), onRemoved: event("removed"), onReplaced: event("replaced")
      },
      declarativeNetRequest: {
        getSessionRules: async () => structuredClone(rig.rules),
        updateSessionRules: async (change) => {
          if (rig.fail) throw new Error("simulated rule failure");
          if (rig.beforeWrite) await rig.beforeWrite();
          rig.writes.push(structuredClone(change));
          rig.rules = rig.rules.filter((r) => !change.removeRuleIds.includes(r.id)).concat(structuredClone(change.addRules));
        }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), context);
  await context.scheduleFrameHeaderRules();
  Object.assign(rig, { context, listeners, sync: () => context.scheduleFrameHeaderRules() });
  rig.message = (sender) => new Promise((resolve) => listeners.message({ type: "ensure-frame-header-rules" }, sender, resolve));
  return rig;
}

test("Rules include all dashboards, excluding other extensions and pending navigations", async () => {
  const rig = await loadBackground([
    { id: 2, url: BASE + "dashboard.html?controls=1" },
    { id: 1, url: BASE + "dashboard.html#test" },
    { id: 3, url: "chrome-extension://other/dashboard.html" },
    { id: 4, url: "file:///dashboard.html" },
    { id: 5, url: BASE + "dashboard.html", pendingUrl: "https://example.org/" }
  ]);
  assert.equal(rig.rules.length, 2);
  for (const rule of rig.rules) assert.deepEqual(rule.condition.tabIds, [1, 2]);
  assert.equal(rig.writes.length, 1, "unchanged rules should not be rewritten");
});

test("Navigating away and closing a dashboard remove its rules", async () => {
  const rig = await loadBackground([{ id: 1, url: BASE + "dashboard.html" }, { id: 2, url: BASE + "dashboard.html" }]);
  rig.tabs[1] = { id: 2, url: "https://example.org/" };
  rig.listeners.updated(2, { url: "https://example.org/" }, rig.tabs[1]);
  await rig.sync();
  assert.deepEqual(rig.rules[0].condition.tabIds, [1]);
  rig.tabs = [];
  rig.listeners.removed(1);
  await rig.sync();
  assert.equal(rig.rules.length, 0);
  assert.ok(rig.writes.at(-1).addRules.length === 0, "never install an unscoped rule");
});

test("Worker startup reconciles stale session rules and preserves unrelated IDs", async () => {
  const rules = [{ id: 9001, condition: { tabIds: [77] } }, { id: 9002, condition: { tabIds: [77] } }, { id: 55, condition: {} }];
  const rig = await loadBackground([], rules);
  assert.deepEqual(rig.rules.map((r) => r.id), [55]);
});

test("Only this extension's dashboard main frame can request rules", async () => {
  const rig = await loadBackground();
  const valid = { id: "test-extension", frameId: 0, tab: { id: 1 }, url: BASE + "dashboard.html" };
  for (const override of [{ frameId: 1 }, { url: "https://example.org/" }, { id: "other" }, { tab: undefined }, { tab: { id: -1 } }]) {
    const result = await rig.message({ ...valid, ...override });
    assert.equal(result.ok, false);
  }
  assert.equal(rig.writes.length, 0);
});

test("Rule failures reach the dashboard and the queue recovers on retry", async () => {
  const rig = await loadBackground();
  rig.tabs = [{ id: 1, url: BASE + "dashboard.html" }];
  rig.fail = true;
  const sender = { id: "test-extension", frameId: 0, tab: { id: 1 }, url: BASE + "dashboard.html" };
  const failure = await rig.message(sender);
  assert.equal(failure.ok, false);
  assert.match(failure.error, /simulated rule failure/);
  rig.fail = false;
  assert.equal((await rig.message(sender)).ok, true);
  assert.deepEqual(rig.rules[0].condition.tabIds, [1]);
});

test("Serialized writes cannot restore stale tab IDs after a slow update", async () => {
  const rig = await loadBackground();
  let release;
  let began;
  const started = new Promise((r) => { began = r; });
  rig.beforeWrite = () => new Promise((r) => { release = r; began(); });
  rig.tabs = [{ id: 1, url: BASE + "dashboard.html" }];
  const first = rig.sync();
  await started;
  rig.tabs = [];
  const second = rig.sync();
  rig.beforeWrite = null;
  release();
  await Promise.all([first, second]);
  assert.equal(rig.rules.length, 0);
});

test("A tab closed before its ID was discovered is removed after the stale query returns", async () => {
  const rig = await loadBackground();
  let release;
  let began;
  const started = new Promise((r) => { began = r; });
  rig.beforeQueryReturns = () => new Promise((r) => { release = r; began(); });
  rig.tabs = [{ id: 1, url: BASE + "dashboard.html" }];
  const sync = rig.sync();
  await started;
  rig.tabs = [];
  rig.listeners.removed(1);
  rig.beforeQueryReturns = null;
  release();
  await sync;
  assert.equal(rig.rules.length, 0);
});
