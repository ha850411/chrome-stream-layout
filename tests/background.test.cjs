"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const BASE = "chrome-extension://test-extension/";

async function loadBackground(initialTabs = [], initialRules = [], initialStorage = {}, initialMenus = []) {
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const memory = structuredClone(initialStorage);
  const storage = {
    get: async (keys) => {
      if (rig.failRead && (Array.isArray(keys) ? keys : [keys]).includes("chrome-stream-layout-state-v1")) throw Error("Read failed");
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, memory[key]]));
    },
    set: async (values) => {
      if (rig.failSave && values["chrome-stream-layout-state-v1"]) throw Error("Write failed");
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: memory[key], newValue: structuredClone(newValue) }]));
      Object.assign(memory, structuredClone(values));
      listeners.storageChanged?.(changes, "local");
    }
  };
  const rig = { memory, tabs: initialTabs, rules: initialRules, writes: [], fail: false,
    menus: new Map(initialMenus.map(item => [item.id, item])), menuResets: 0, createdTabs: [], focusedWindows: [] };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    structuredClone,
    console: { warn() {} },
    importScripts: (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context); },
    chrome: {
      storage: { local: storage, session: storage, onChanged: event("storageChanged") },
      runtime: { id: "test-extension", getURL: (p) => BASE + p, onMessage: event("message"), onInstalled: event("installed"), onStartup: event("startup") },
      action: { onClicked: event("click") },
      contextMenus: {
        onClicked: event("contextClick"),
        create: (item, callback) => { assert.equal(rig.menus.has(item.id), false); rig.menus.set(item.id, structuredClone(item)); callback(); return item.id; },
        update: async (id, properties) => { if (!rig.menus.has(id)) throw Error("Missing menu"); Object.assign(rig.menus.get(id), structuredClone(properties)); },
        removeAll: async () => { rig.menuResets++; rig.menus.clear(); }
      },
      windows: { update: async (id, properties) => { rig.focusedWindows.push({ id, ...properties }); } },
      tabs: {
        query: async () => {
          const snapshot = structuredClone(rig.tabs);
          if (rig.beforeQueryReturns) await rig.beforeQueryReturns();
          return snapshot;
        },
        create: async (properties) => {
          const tab = { id: Math.max(0, ...rig.tabs.map(tab => tab.id)) + 1, windowId: 1, ...properties };
          rig.tabs.push(tab); rig.createdTabs.push(tab); return tab;
        },
        update: async (id, properties) => {
          const tab = rig.tabs.find(tab => tab.id === id);
          assert.ok(tab); Object.assign(tab, properties); return tab;
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
  await context.refreshSourceContextMenu();
  Object.assign(rig, { context, listeners, sync: () => context.scheduleFrameHeaderRules() });
  rig.message = (sender, origins) => new Promise((resolve) => listeners.message({ type: "ensure-frame-header-rules", ...(origins === undefined ? {} : { origins }) }, sender, resolve));
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
  assert.equal(rig.rules.length, 1);
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


test("Compatibility header removal is limited to selected origins in its own dashboard", async () => {
  const rig = await loadBackground([{ id: 1, url: BASE + "dashboard.html" }, { id: 2, url: BASE + "dashboard.html" }]);
  const sender = { id: "test-extension", frameId: 0, tab: { id: 1 }, url: BASE + "dashboard.html" };
  assert.equal((await rig.message(sender, ["https://video.example", "http://127.0.0.1:8080"])).ok, true);
  const scoped = rig.rules.find((rule) => rule.id >= 10000);
  assert.deepEqual(scoped.condition.tabIds, [1]);
  const pattern = new RegExp(scoped.condition.regexFilter);
  assert.ok(pattern.test("https://video.example/watch?a=1"));
  assert.ok(pattern.test("http://127.0.0.1:8080/stream"));
  for (const url of ["https://other.example/", "https://videoXexample/", "https://video.example.evil/", "https://video.example@evil/"]) assert.equal(pattern.test(url), false);
  assert.equal((await rig.message(sender, [])).ok, true);
  assert.equal(rig.rules.filter((rule) => rule.action.responseHeaders).length, 0);
});

test("Same-tab legacy blanket rules are replaced and invalid origins are rejected", async () => {
  const rig = await loadBackground([{ id: 1, url: BASE + "dashboard.html" }], [
    { id: 9001, condition: { tabIds: [1], regexFilter: "^https?://" } },
    { id: 9002, condition: { tabIds: [1] }, action: { type: "block" } }
  ]);
  assert.equal(rig.rules.length, 1);
  assert.equal(rig.rules[0].action.type, "modifyHeaders");
  const sender = { id: "test-extension", frameId: 0, tab: { id: 1 }, url: BASE + "dashboard.html" };
  for (const origins of [["file:///tmp"], ["https://video.example/path"], ["https://a.example", "https://b.example", "https://c.example", "https://d.example", "https://e.example"]]) {
    assert.equal((await rig.message(sender, origins)).ok, false);
  }
});


test("Worker restart preserves configured origins and closing a tab clears its session configuration", async () => {
  const tabs = [{ id: 7, url: BASE + "dashboard.html" }];
  const first = await loadBackground(tabs);
  const sender = { id: "test-extension", frameId: 0, tab: { id: 7 }, url: BASE + "dashboard.html" };
  await first.message(sender, ["https://persisted.example"]);
  const restarted = await loadBackground(tabs, first.rules, first.memory);
  assert.equal(restarted.writes.length, 0, "matching complete rules survive worker suspension");
  assert.ok(restarted.rules.some((rule) => rule.condition.regexFilter?.includes("persisted")));
  restarted.tabs = [];
  restarted.listeners.removed(7);
  await restarted.sync();
  assert.equal(restarted.rules.length, 0);
  assert.deepEqual(Object.keys(restarted.memory["chrome-stream-layout-frame-origins-v1"]), []);
});

test("Page context menu lists four current sources, empty panes and hidden-pane expansion", async () => {
  const rig = await loadBackground([], [], { "chrome-stream-layout-state-v1": {
    language: "zh-TW", layout: 2, slots: [{ url: "https://www.twitch.tv/sam1268", title: "Twitch · sam1268" }, { url: "https://kick.com/eslcs", title: "A %s stream" }]
  } });
  assert.equal(rig.menus.size, 5);
  assert.match(rig.menus.get("stream-layout-add-page-0").title, /sam1268.*替換/);
  assert.match(rig.menus.get("stream-layout-add-page-1").title, /kick.com\/eslcs/);
  assert.equal(rig.menus.get("stream-layout-add-page-1").title.includes("%s"), false);
  assert.match(rig.menus.get("stream-layout-add-page-2").title, /空白.*展開為 3 格/);
  assert.match(rig.menus.get("stream-layout-add-page-3").title, /空白.*展開為 4 格/);
  for (const item of rig.menus.values()) assert.deepEqual(item.documentUrlPatterns, ["http://*/*", "https://*/*"]);
  assert.ok(rig.listeners.contextClick);
});

test("Context-menu labels track saved sources/language and survive worker restarts without duplication", async () => {
  const rig = await loadBackground();
  await rig.context.chrome.storage.local.set({ "chrome-stream-layout-state-v1": { language: "en", slots: [{ url: "https://example.com/new", title: "New source" }] } });
  await rig.context.refreshSourceContextMenu();
  assert.match(rig.menus.get("stream-layout-add-page-0").title, /Pane 1.*New source.*replace/);
  const restarted = await loadBackground(rig.tabs, rig.rules, rig.memory, [...rig.menus.values()]);
  assert.equal(restarted.menus.size, 5);
  assert.equal(restarted.menuResets, 0);
});

test("Context-menu click adds the top-level page, creates one dashboard, then reuses it", async () => {
  const rig = await loadBackground([{ id: 1, windowId: 7, url: "https://source.example/live", title: "Live page" }]);
  const info = { menuItemId: "stream-layout-add-page-2", pageUrl: "https://source.example/live", frameUrl: "https://iframe.example/", linkUrl: "https://link.example/", srcUrl: "https://video.example/file.mp4" };
  rig.listeners.contextClick(info, rig.tabs[0]);
  assert.equal(await vm.runInContext("sourceActionQueue", rig.context), true);
  assert.equal(rig.memory["chrome-stream-layout-state-v1"].slots[2].url, info.pageUrl);
  assert.equal(rig.memory["chrome-stream-layout-state-v1"].slots[2].title, "Live page");
  assert.equal(rig.createdTabs.length, 1);
  assert.match(rig.createdTabs[0].url, /dashboard.html#sourceMenu=added&pane=3/);
  await rig.context.handleSourceContextClick({ ...info, menuItemId: "stream-layout-add-page-0" }, rig.tabs[0]);
  assert.equal(rig.createdTabs.length, 1);
  assert.equal(rig.createdTabs[0].active, true);
  assert.match(rig.createdTabs[0].url, /pane=1/);
});

test("Context-menu failures are shown without saving defaults or changing existing sources", async () => {
  const rig = await loadBackground([], [], { "chrome-stream-layout-state-v1": { slots: [{ url: "https://kept.example/" }] } });
  const saved = structuredClone(rig.memory["chrome-stream-layout-state-v1"]);
  const info = { menuItemId: "stream-layout-add-page-0", pageUrl: "https://new.example/" };
  for (const failure of ["failRead", "failSave"]) {
    rig[failure] = true;
    assert.equal(await rig.context.handleSourceContextClick(info, {}), false);
    assert.deepEqual(rig.memory["chrome-stream-layout-state-v1"], saved);
    assert.match(rig.createdTabs[0].url, /sourceMenu=failed/);
    rig[failure] = false;
  }
  assert.equal(await rig.context.handleSourceContextClick(info, {}), true);
  assert.match(rig.createdTabs[0].url, /sourceMenu=added/);
});

test("Unknown menu items are ignored and web frames cannot invoke the internal assignment operation", async () => {
  const rig = await loadBackground();
  assert.equal(await rig.context.handleSourceContextClick({ menuItemId: "stream-layout-add-page-4" }, {}), false);
  assert.equal(rig.createdTabs.length, 0);
  assert.equal(rig.listeners.message({ type: "assign-page-source", index: 0, url: "https://new.example/" }, { id: "test-extension", frameId: 1, url: "https://web.example/" }, () => assert.fail("Unexpected response")), false);
});
